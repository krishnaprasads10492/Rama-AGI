import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useUserStore } from '@store/userStore.js';
import PriceChart from './PriceChart.jsx';
import BookPanel from './BookPanel.jsx';
import WhyPanel from './WhyPanel.jsx';
import PanelBoard from '@components/PanelBoard.jsx';
import SymbolSearch from './SymbolSearch.jsx';
import StrategyBuilder from './StrategyBuilder.jsx';
import HelpPanel from './HelpPanel.jsx';
import InfoTip from './InfoTip.jsx';
import {
  defaultRangeFor, reconcileRange, capBarsFor, datesForRange, limitForDates, rangeForDates, toYmd,
} from './timeframes.js';

/**
 * WHAT THE CHART OPENS ON (spec Section 107).
 *
 * Master: "whenever chart tab opened, by default open in 30 min timeframe and for last 4 days."
 *
 * 30-minute bars over four sessions is about 52 candles — a legible chart with enough detail to see
 * intraday structure, which is a better first impression than a year of daily bars where nothing is
 * happening. It is also well inside the provider's one-month cap for 30m, so the default can always be
 * served.
 */
const OPEN_INTERVAL = '30m';
const OPEN_SESSIONS = 4;

function openingDates(sessions = OPEN_SESSIONS) {
  const to = new Date();
  const from = new Date(to.getTime());
  // Calendar days, with slack for a weekend: four SESSIONS back from a Monday is the previous Tuesday.
  from.setDate(from.getDate() - (sessions + 3));
  return { from: toYmd(from), to: toYmd(to) };
}

/** The from/to a fresh interval starts on, so the two states are never seeded inconsistently. */
function defaultDates(intervalId) {
  const d = datesForRange(defaultRangeFor(intervalId)) || { from: null, to: '' };
  return { from: d.from || '', to: d.to || '' };
}
import { riskBudget, whyCannotPredict } from './positionMath.js';

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

/**
 * One labelled figure.
 *
 * `info` names a glossary term (Section 104). It was `title` only, and only two of the eight WHY
 * statistics ever passed one — so `UNCERTAINTY 0.031` sat on the screen with no way to find out what
 * it was or what to do about it. A `?` is visible; a `title` is not.
 */
function Stat({ label, value, color, title, info }) {
  return (
    <div title={title} style={{ minWidth: '78px' }}>
      <div style={{ fontSize: '12.5px', color: 'var(--muted)', letterSpacing: '0.08em',
        display: 'flex', alignItems: 'center' }}>
        {label}{info && <InfoTip id={info} />}
      </div>
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
  // `barCount` is GONE (Section 105). Master: "why is there a field-count of bars? they are calculated
  // based on timeframe and time interval." Correct — a count is a consequence of the other two, and
  // three controls for two facts invited them to disagree. The window is now the dates it covers, and
  // the request's payload ceiling is derived from those dates.
  const [fromDate, setFromDate] = useState(() => openingDates().from);
  const [toDate, setToDate] = useState(() => openingDates().to);

  const [status, setStatus]   = useState('idle');
  const [result, setResult]   = useState(null);
  const [error,  setError]    = useState(null);
  // The engine's last stderr lines when a request failed because the engine did (Section 99).
  const [engineTail, setEngineTail] = useState([]);
  // Where Rāma knocked and with what, kept as a secondary line rather than as the message (Section 106).
  const [engineDetail, setEngineDetail] = useState(null);
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
  // The four faces of one activity (Section 105): what a rule says NOW, the same rule over history,
  // the forward range, and the evidence under all three.
  const [strat, setStrat] = useState('now');
  // NOT named `interval`/`setInterval`: that shadows the global `setInterval` inside this
  // component, and the failure would look like a mystery rather than a name collision.
  const [barInterval, setBarInterval] = useState(OPEN_INTERVAL);
  // The lookback window (Section 101). A timeframe is the PAIR — interval alone cannot say whether
  // master wants three days of 5m bars or a month of them. `null` means NO date filter at all, which is
  // what clicking the selected preset produces (Section 107).
  const [barRange, setBarRange] = useState(null);
  // Every symbol Rāma actually holds, so the picker can mark the no-network choices.
  const [inventory, setInventory] = useState([]);
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
    // The window is a DATE RANGE; the limit is only a payload ceiling derived from it, and it is
    // clamped to what the provider can serve for this interval. Asking Yahoo for a year of 1m bars
    // returns HTTP 422, which arrives here as zero bars — indistinguishable from a misspelt symbol
    // (Sections 101, 105).
    const limit = limitForDates(barInterval, fromDate, toDate);
    const res = await window.rama.marketIntel.ohlcv({
      user: currentUser, symbol: sym, exchange,
      interval: barInterval, limit, sync: doSync,
      fromDate: fromDate || null, toDate: toDate || null,
    });
    setBarsBusy(false);
    if (res?.ok === false) {
      // The bars path is where master met this, and it was the ONE surface that showed only the raw
      // string — the diagnosis and the engine's own output were on the reply and discarded here
      // (Section 106).
      setBarsNote(res.error || 'Could not load price history');
      setEngineTail(Array.isArray(res.stderrTail) ? res.stderrTail : []);
      setEngineDetail(res.detail || null);
      return;
    }
    setEngineDetail(null);
    setBars(res.data?.bars || []);
    setBarsMeta(res.data || null);
    if (res.data?.note) setBarsNote(res.data.note);
  }, [sym, exchange, fromDate, toDate, currentUser, barInterval]);

  // ── The timeframe pair (Section 101) ────────────────────────────────────────
  //
  // Changing interval RECONCILES the window rather than resetting it: switching 1d/1Y to 5m cannot
  // keep a year, so it falls to the deepest window 5m can serve. Silently keeping "1Y" selected
  // while fetching one month would make the control lie about what is on screen.
  const pickInterval = useCallback((id) => {
    setBarInterval(id);
    // NO RECONCILING WHEN THERE IS NO FILTER (Section 107). Reconciling a null range would silently
    // impose one, which is the opposite of what clearing it meant. And a window master chose is kept
    // as chosen now rather than pulled back to what the provider serves — the shortfall is reported
    // instead of prevented.
    if (!barRange) return;
    const next = reconcileRange(id, barRange) || barRange;
    const d = datesForRange(next) || { from: null, to: '' };
    setBarRange(next);
    setFromDate(d.from || '');
    setToDate(d.to || '');
  }, [barRange]);

  // `null` means REMOVE THE FILTER — every bar Rāma holds for this interval. That is what clicking an
  // already-selected preset does, at master's instruction: a preset is a convenience, not a constraint
  // (Section 107).
  const pickRange = useCallback((id) => {
    if (!id) {
      setBarRange(null);
      setFromDate('');
      setToDate('');
      return;
    }
    const d = datesForRange(id) || { from: null, to: '' };
    setBarRange(id);
    setFromDate(d.from || '');
    setToDate(d.to || '');
  }, []);

  // A hand-typed date makes the preset row show "custom" rather than keep a button lit that no longer
  // describes what is on screen — a highlighted preset that disagrees with the dates is worse than no
  // highlight, because it is a claim.
  const setDates = useCallback((nextFrom, nextTo) => {
    setFromDate(nextFrom);
    setToDate(nextTo);
    setBarRange(rangeForDates(barInterval, nextFrom || null, nextTo || null));
  }, [barInterval]);

  // What Rāma already holds, so the symbol picker can mark the choices that need no network.
  const loadInventory = useCallback(async () => {
    if (!inElectron) return;
    const res = await window.rama.marketIntel.inventory({ user: currentUser });
    // A failed inventory read is not an error worth showing: the picker degrades to the known list,
    // which is still every name the engine can resolve.
    setInventory(res?.ok === false ? [] : (res.data?.inventory || []));
  }, [currentUser]);

  // Does Rāma already hold bars for the selected instrument? Worth saying, because a stored series
  // draws instantly and an unstored one needs a network fetch that may fail.
  const heldHere = useMemo(() => inventory.some((r) => String(r?.symbol || '').toUpperCase() === sym),
    [inventory, sym]);

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
      loadInventory();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── THE CHART REDRAWS ON EVERY FILTER, INCLUDING THE SYMBOL (Section 105) ──
  //
  // Master: "charts should show the bars automatically whenever stock/item is selected — based on other
  // filters." It did not. `sym` and `exchange` were absent from this list, so choosing a new instrument
  // left the PREVIOUS instrument's candles on screen under the new symbol's name until master pressed
  // a button — which is not a stale chart, it is a chart showing one instrument labelled as another.
  useEffect(() => {
    if (inElectron && canView) loadBars(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sym, exchange, barInterval, fromDate, toDate]);

  // Clear the old instrument's bars the instant the symbol changes, so the gap between the change and
  // the fetch shows a loading state rather than the wrong instrument.
  useEffect(() => {
    setBars([]);
    setBarsMeta(null);
    setResult(null);
    setSelected(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sym, exchange]);

  // A new exchange means a different instrument universe, so the picker is refreshed with it.
  useEffect(() => {
    if (inElectron && canView) loadInventory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exchange]);

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
      // The engine's own last lines, when the failure was an engine failure (Section 99).
      setEngineTail(Array.isArray(res.stderrTail) ? res.stderrTail : []);
      setEngineDetail(res.detail || null);
      setStatus('error');
      return;
    }
    setEngineTail([]);
    setEngineDetail(null);
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

  // RISK % in money, and the position size it implies against master's own stop when he has one.
  const budget = useMemo(
    () => riskBudget(capital, riskPct, lastClose, held?.thesis?.stopPrice ?? null),
    [capital, riskPct, lastClose, held?.thesis?.stopPrice],
  );

  // One sentence for why Generate Signals cannot run, so the greyed-out button is never a mystery.
  const cannotPredict = useMemo(() => whyCannotPredict({
    inElectron, canRequest, busy: status === 'requesting',
    symbol: sym, capital, riskPct, lastClose,
  }), [canRequest, status, sym, capital, riskPct, lastClose]);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', background: 'var(--surface)',
        display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
        {/* EVERY BADGE IN THIS BAR WAS JARGON WITH NO EXPLANATION (Section 104). "ABSORBED ENGINE"
            said nothing a user could act on, "DONE" did not say done of what, and "contract aligned"
            is a phrase only the author understood. Each now carries its definition. */}
        <span style={{ fontWeight: 700, color: 'var(--magenta)', letterSpacing: '0.1em' }}>STOCKMIND AI</span>
        <span className="badge badge-magenta" style={{ display: 'inline-flex', alignItems: 'center' }}>
          ABSORBED ENGINE<InfoTip id="absorbedEngine" />
        </span>
        <span className={`badge ${status === 'done' ? 'badge-green' : status === 'requesting' ? 'badge-amber' : status === 'error' ? 'badge-red' : ''}`}
              style={{ display: 'inline-flex', alignItems: 'center' }}>
          {status === 'idle' ? 'NO REQUEST YET'
            : status === 'done' ? 'SIGNALS READY'
              : status === 'requesting' ? 'REQUESTING' : 'REQUEST FAILED'}
          <InfoTip id="engineStatus" />
        </span>
        <div style={{ flex: 1 }} />
        {engine && !engine.error && (
          <span style={{ fontSize: '12px', color: 'var(--muted)', display: 'inline-flex',
            alignItems: 'center' }}
                title={engine.note || ''}>
            {engine.registry?.models_trained || 0} models trained
            <InfoTip id="modelsTrained" side="left" />
            <span style={{ padding: '0 6px' }}>·</span>
            <span style={{ color: engine.featureContract?.aligned ? 'var(--muted)' : 'var(--red)' }}>
              {engine.featureContract?.aligned ? 'inputs match training' : 'INPUTS NO LONGER MATCH'}
            </span>
            <InfoTip id="featureContract" side="left" />
          </span>
        )}
      </div>

      {/* Tabs, not a seven-card scroll (Section 79). The chart is the primary surface. */}
      <div style={{
        display: 'flex', gap: '2px', padding: '0 20px', background: 'var(--surface)',
        borderBottom: '1px solid var(--border)', flexShrink: 0,
      }} role="tablist">
        {/* ── SIX TABS, GROUPED BY ACTIVITY (Section 105) ───────────────────────────────────────
            Master: "generating signals does mean to strategise… projection should be part of strategy,
            of course utilising the same charts."

            He is right, and it corrects Section 103's own split. SIGNALS, WHY, STRATEGY and the
            projection toggle were four separate places for one activity: deciding what to do about an
            instrument. A signal is what a rule emits NOW, a backtest is the same rule over history, a
            projection is the forward range, and WHY is the evidence under all of them. The research
            agrees — TradingView puts its Strategy Tester in a panel of the chart rather than on a
            separate screen, and the report "opens automatically when you add any strategy".

            So eight tabs became six, and the four strategy surfaces became sub-tabs of one. The chart
            stays separate because it is the reference surface every other tab talks about. */}
        {[
          ['chart', 'CHART'],
          ['strategise', '⚗ STRATEGISE'],
          ['book', 'YOUR BOOK'],
          ['engine', 'ENGINE'],
          // HELP last in the strip and first in the answer to "what is this" (Section 104). A module
          // whose every screen needs a glossary should carry the glossary, not assume master will find
          // it elsewhere.
          ['help', '? HELP'],
          // The draggable multi-window mode (Section 97). ADDED alongside the tabs rather than
          // replacing them: tabs are faster for a single focused question, a board is better for
          // watching several things at once, and removing a working layout to add a new one would
          // be a capability regression. Master picks per task.
          ['workspace', '◈ WORKSPACE'],
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

        {/* ── The request form, in three labelled groups (Section 104) ──────────────────────────
            IT WAS ONE UNDIFFERENTIATED GRID of six fields over a flat row of four buttons, which
            reads as a wall rather than as a sequence. Master asked for the screens to be simplified
            by grouping, and the research answer is progressive disclosure: put the few controls that
            serve most tasks first, and defer the rest behind one clearly-labelled click.

            So the groups are WHAT (instrument, exchange), MONEY (capital, risk, base price) and then
            ACTIONS — and the expert controls (direction filter, exact bar count) move into a
            collapsed ADVANCED row. Nothing is removed; a novice sees five fields instead of eight,
            and an expert pays one click. */}
        <div className="hud-card" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <div className="section-label">1 · WHAT ARE YOU LOOKING AT</div>
            <InfoTip id="instrument" />
            <span style={{ flex: 1 }} />
            <button type="button" className="btn btn-sm" onClick={() => setTab('help')}
                    title="Every field on this page, explained, plus a glossary">
              ? new here
            </button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
            {/* SYMBOL IS A SEARCH (Section 102). Master's objection to the previous version was
                exact: a curated dropdown of fifty names plus a raw text box cannot answer "what is
                Reliance Power called", which is the question a picker exists for. This asks the
                provider, falls back to Rāma's own list when the engine cannot be reached, and still
                commits free text on Enter (I11). Picking a result also sets the exchange, because
                the exchange is a property of the instrument rather than an independent choice —
                master could previously pick RELIANCE with NASDAQ and get nothing back. */}
            <div>
              <div style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '4px' }}>
                <label htmlFor="stockmind-symbol">INSTRUMENT</label>
              </div>
              <SymbolSearch
                id="stockmind-symbol"
                value={sym}
                exchange={exchange}
                inventory={inventory}
                onPick={({ symbol: s, exchange: ex }) => {
                  setSymbol(s);
                  if (ex && ex !== exchange) setExchange(ex);
                }}
                ariaLabel="Search for a stock, index, ETF, currency or crypto"
              />
              <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '2px' }}>
                {heldHere
                  ? '● Rāma already holds bars for this one'
                  : 'Type a name or a ticker. Any market.'}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '4px' }}>
                <label htmlFor="stockmind-exchange">EXCHANGE</label>
                <InfoTip id="exchange" />
              </div>
              <select className="input" id="stockmind-exchange" value={exchange}
                      onChange={e => setExchange(e.target.value)}
                      title="Set automatically when you pick a search result. Change it only to
override where an unlisted ticker should be looked up.">
                <option value="NSE">NSE — India</option>
                <option value="BSE">BSE — India</option>
                <option value="NASDAQ">NASDAQ — US</option>
                <option value="NYSE">NYSE — US</option>
              </select>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap',
            borderTop: '1px solid var(--border)', paddingTop: '10px' }}>
            <div className="section-label">2 · HOW MUCH ARE YOU RISKING</div>
            <InfoTip id="riskAmount" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
            <div>
              <div style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '4px',
                display: 'flex', alignItems: 'center' }}>
                <label htmlFor="stockmind-base">BASE PRICE</label>
                <InfoTip id="basePrice" />
              </div>
              <input className="input" id="stockmind-base" value={lastClose ?? ''} readOnly
                     placeholder="load history →"
                     title="Taken from the last stored bar rather than typed, so a signal cannot be priced off a stale number." />
              <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '2px' }}>
                {lastClose == null ? 'load history first' : 'last stored close'}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '4px',
                display: 'flex', alignItems: 'center' }}>
                <label htmlFor="stockmind-capital">CAPITAL</label>
                <InfoTip id="capital" />
              </div>
              <input className="input" id="stockmind-capital" type="number" min="0" step="1000"
                     value={capital} onChange={e => setCapital(e.target.value)} />
              <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '2px' }}>
                {budget.capital != null
                  ? budget.capital.toLocaleString()
                  : 'the amount you are sizing against'}
              </div>
            </div>
            {/* RISK % USED TO SHOW ONLY A PERCENTAGE (Section 102), so the number master was actually
                choosing — how much money is at stake — was his to work out in his head on every
                change. It is one multiplication and it is the whole point of the field. */}
            <div>
              <div style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '4px',
                display: 'flex', alignItems: 'center' }}>
                <label htmlFor="stockmind-risk">RISK %</label>
                <InfoTip id="riskPct" />
              </div>
              <input className="input" id="stockmind-risk" type="number" step="0.25" min="0.25"
                     max="10" value={riskPct} onChange={e => setRiskPct(e.target.value)} />
              <div style={{ fontSize: '12px', marginTop: '2px',
                color: budget.ok ? 'var(--amber)' : 'var(--muted)' }}>
                {budget.ok
                  ? `${budget.amount.toLocaleString(undefined, { maximumFractionDigits: 0 })} at risk`
                  : (budget.reason || '—')}
                {budget.ok && budget.units != null && (
                  <span style={{ color: 'var(--muted)' }}>
                    {' '}· about {budget.units.toLocaleString()} units to your stop
                  </span>
                )}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px',
            borderTop: '1px solid var(--border)', paddingTop: '10px', flexWrap: 'wrap' }}>
            <div className="section-label">3 · WHAT DO YOU WANT</div>
            {/* THE TWO LOAD BUTTONS NEEDED DISTINGUISHING (Section 102). "Load history" and
                "Fetch & store" differ only in whether the network is touched, and only one of them
                said so — a distinction only the author understood. They now read as "from disk" and
                "from the internet", which is the actual difference. */}
            <button className="btn" disabled={barsBusy || !canView} onClick={() => loadBars(false)}
                    title="Read bars already stored on this machine. No network.">
              {barsBusy ? 'Loading…' : '↺ From disk'}
            </button>
            <button className="btn" disabled={barsBusy || !canView} onClick={() => loadBars(true)}
                    title="Ask the provider chain for anything missing and store it. Reaches back as
far as the provider allows, which for intraday is a few days to two years.">
              ⇩ Fetch from provider
            </button>
            <button className="btn" disabled={newsBusy || !canView} onClick={loadNews}
                    title="Pull recent headlines for this instrument and score their tone.">
              {newsBusy ? 'Reading…' : '📰 Read news'}
            </button>
            <div style={{ flex: 1 }} />
            {/* A DISABLED BUTTON WITH NO STATED CAUSE IS A DEAD END. Master could not tell whether
                Rāma was busy, whether his tier was too low, or whether a field above was empty. */}
            {cannotPredict && (
              <span style={{ fontSize: '12.5px', color: 'var(--amber)', maxWidth: '42ch',
                lineHeight: 1.5 }}>
                {cannotPredict}
              </span>
            )}
            <button
              className="btn btn-primary"
              disabled={!!cannotPredict}
              title={cannotPredict || 'Ask the engine for signals on this instrument'}
              onClick={runPredict}
            >
              {status === 'requesting' ? 'Requesting…' : '⚡ Generate Signals'}
            </button>
          </div>

          {/* ── ADVANCED, collapsed (Section 104) ────────────────────────────────────────────────
              Progressive disclosure: the direction filter and the exact bar count serve a minority of
              requests, so they are behind one labelled click. The research finding is that novices
              learn faster and err less while experts pay exactly one click — and neither control is
              removed, which is what separates this from simplification by deletion. */}
          <details style={{ borderTop: '1px solid var(--border)', paddingTop: '8px' }}>
            <summary style={{ cursor: 'pointer', fontSize: '12px', color: 'var(--muted)',
              letterSpacing: '0.08em' }}>
              ADVANCED — direction filter, exact bar count
            </summary>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: '12px', flexWrap: 'wrap',
              paddingTop: '10px' }}>
              <div>
                <div style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '4px',
                  display: 'flex', alignItems: 'center' }}>
                  <label htmlFor="stockmind-direction">DIRECTION FILTER</label>
                  <InfoTip id="directionFilter" />
                </div>
                <select className="input" id="stockmind-direction" style={{ width: '130px' }}
                        value={direction} onChange={e => setDirection(e.target.value)}>
                  <option value="both">Both</option>
                  <option value="long">Long only</option>
                  <option value="short">Short only</option>
                </select>
              </div>
              <span style={{ fontSize: '12px', color: 'var(--muted)', paddingBottom: '6px',
                maxWidth: '52ch', lineHeight: 1.6 }}>
                The bar count is gone — it was only interval × window restated, and a third control for
                two facts invited them to disagree. Interval and dates live on the chart.
                {capBarsFor(barInterval) != null
                  && ` Free ${barInterval} data reaches back about `
                    + `${capBarsFor(barInterval).toLocaleString()} bars.`}
              </span>
            </div>
          </details>

          {barsNote && (
            <div style={{ fontSize: '12.5px', color: 'var(--amber)', lineHeight: 1.7 }}>
              {barsNote}
              {engineTail.length > 0 && (
                <details style={{ marginTop: 6 }}>
                  <summary style={{ cursor: 'pointer', color: 'var(--text-dim)', fontSize: '12px' }}>
                    engine output
                  </summary>
                  <pre style={{
                    margin: '6px 0 0', padding: '8px 10px', maxHeight: 140, overflow: 'auto',
                    background: 'rgba(0,0,0,0.35)', border: '1px solid var(--border)',
                    fontSize: '11.5px', color: 'var(--text-dim)', whiteSpace: 'pre-wrap',
                  }}>{engineTail.join('\n')}</pre>
                </details>
              )}
              {engineDetail && (
                <div style={{ color: 'var(--text-dim)', fontSize: '12px', marginTop: '4px' }}>
                  {engineDetail}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Error */}
        {status === 'error' && error && (
          <div style={{ padding: '12px 16px', background: 'rgba(255,60,60,0.08)', border: '1px solid rgba(255,60,60,0.3)',
            borderRadius: 'var(--radius)', color: 'var(--red)', fontSize: '12px' }}>
            ✕ {error}
            {/* The old hint said "it may still be starting — try again" for EVERY failure, which was
                advice to wait for a problem that waiting could never fix. A diagnosed failure now
                shows the engine's actual last words instead (Section 99). */}
            {engineTail.length > 0 && (
              <details style={{ marginTop: 8 }}>
                <summary style={{ cursor: 'pointer', color: 'var(--text-dim)', fontSize: '12px' }}>
                  engine output
                </summary>
                <pre style={{
                  margin: '6px 0 0', padding: '8px 10px', maxHeight: 140, overflow: 'auto',
                  background: 'rgba(0,0,0,0.35)', border: '1px solid var(--border)',
                  fontSize: '11.5px', color: 'var(--text-dim)', whiteSpace: 'pre-wrap',
                }}>{engineTail.join('\n')}</pre>
              </details>
            )}
            {/* The URL, demoted to a detail (Section 106). Master saw it as the whole message; it is
                worth keeping, because "which port did Rāma knock on" is a real question — but it is
                never the answer to "why is the engine not running". */}
            {engineDetail && (
              <div style={{ marginTop: '6px', color: 'var(--text-dim)', fontSize: '12px' }}>
                {engineDetail}
              </div>
            )}
          </div>
        )}

        {/* Chart */}
        {/* ── Workspace: the same surfaces, arrangeable and poppable (Section 97) ──
            Each panel RE-USES the existing components rather than reimplementing them, so a fix to
            PriceChart or BookPanel lands in both modes and the two cannot drift apart. */}
        {/* No negative margin on the board wrapper below. `margin: -20px` was cancelling the parent's
            padding, which made the board 40px WIDER than its container — and with `overflow: hidden`
            on the board, panels near the right edge were clipped rather than contained (Section 100). */}
        {tab === 'workspace' && (
          // `minWidth: 0` on the flex wrapper as well, and a real minimum height. The board's children
          // are absolutely positioned, so without these it is sized by an intrinsic width of zero
          // (Section 105).
          <div style={{ flex: 1, minHeight: 640, minWidth: 0, display: 'flex' }}>
            <PanelBoard
              storageKey="rama.stockmind.workspace"
              onPopOut={async (p) => {
                if (!inElectron || !window.rama?.popout) return false;
                // A separate renderer sees neither these bars nor this login, so it is told what to
                // fetch and given a single-use ticket for the session (Section 109).
                const res = await window.rama.popout.open({
                  panel: p.id,
                  title: p.title,
                  params: {
                    symbol, exchange, interval: barInterval, range: barRange || undefined,
                    user: currentUser,
                  },
                });
                return res?.ok !== false;
              }}
              panels={[
                {
                  id: 'chart',
                  title: `${sym} · ${barInterval} · ${barRange}`,
                  x: 16, y: 16, w: 720, h: 400,
                  // The panel gets the SAME timeframe control as the tab, because it is the same
                  // component — a board where the chart cannot change interval would send master
                  // back to the tabs for the one thing he changes most.
                  render: () => <PriceChart bars={bars} signal={selected} symbol={sym}
                                            interval={barInterval} rangeId={barRange}
                                            onInterval={pickInterval} onRange={pickRange}
                                            fromDate={fromDate} toDate={toDate} onDates={setDates}
                                            chartId="sm-ws-chart"
                                            busy={barsBusy} onFetch={() => loadBars(true)}
                                            basePrice={held?.avgCost ?? null}
                                            height={260}
                                            cone={coneOn ? cone : null} />,
                },
                {
                  id: 'signals',
                  title: 'SIGNALS',
                  x: 752, y: 16, w: 420, h: 400,
                  render: () => (result?.signals?.length
                    ? result.signals.map((s, i) => (
                        <SignalRow key={i} signal={s}
                                   selected={selected === s}
                                   onSelect={() => setSelected(s)} />
                      ))
                    : <span style={{ fontSize: 12, color: 'var(--muted)' }}>No signals yet.</span>),
                },
                {
                  id: 'book',
                  title: 'YOUR BOOK',
                  x: 16, y: 432, w: 560, h: 300,
                  // `currentUser` and `canConfig` are NOT optional. Omitting them sent `user:
                  // undefined` to the capability gate, which correctly refused with
                  // "Access denied: stockmind.view is not available unauthenticated" — the panel
                  // looked broken while the gate was doing its job (Section 100).
                  render: () => <BookPanel currentUser={currentUser} canConfig={canConfig}
                                           symbol={sym} exchange={exchange} lastClose={lastClose}
                                           onPickSymbol={(s) => { setSymbol(s); setTab('chart'); }} />,
                },
                {
                  id: 'why',
                  title: 'WHY',
                  x: 592, y: 432, w: 580, h: 300,
                  // `thesis`, not `signal` — WhyPanel has no `signal` prop, so the value was silently
                  // discarded. A wrong prop name fails quietly in React, which is why the panel
                  // rendered without complaint and simply showed nothing useful.
                  render: () => <WhyPanel currentUser={currentUser} symbol={sym} exchange={exchange}
                                          thesis={held?.thesis || null} />,
                },
              ]}
            />
          </div>
        )}

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
              {/* The projection TOGGLE moved to STRATEGISE → PROJECTION (Section 105) — it is a
                  forward view, so it is a strategy question rather than a chart setting. What stays
                  here is a statement that it is on, and the way back to its controls, because a cone
                  drawn by a switch on another tab must be traceable to that switch. */}
              {coneOn && (
                <button type="button" className="btn btn-sm"
                        onClick={() => { setTab('strategise'); setStrat('projection'); }}
                        title="The projection is drawn from STRATEGISE → PROJECTION">
                  projection on ⚗
                </button>
              )}
            </div>
            <PriceChart
              bars={bars}
              signal={selected}
              symbol={sym}
              interval={barInterval}
              rangeId={barRange}
              onInterval={pickInterval}
              onRange={pickRange}
              fromDate={fromDate}
              toDate={toDate}
              onDates={setDates}
              chartId="sm-chart"
              busy={barsBusy}
              onFetch={() => loadBars(true)}
              basePrice={held?.avgCost ?? null}
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


        {tab === 'help' && <HelpPanel />}

        {/* ── STRATEGISE: one activity, four faces ─────────────────────────────────────────────── */}
        {tab === 'strategise' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}
               role="tablist" aria-label="Strategise">
            {[
              ['now', 'NOW', 'What a reading of this instrument says at this moment'],
              ['build', 'BUILD & TEST', 'A rule, judged over history the search never saw'],
              ['projection', 'PROJECTION', 'The range this instrument\'s own volatility calls ordinary'],
              ['why', 'WHY', 'The evidence under all three'],
            ].map(([id, label, hint]) => (
              <button key={id} type="button" role="tab" aria-selected={strat === id}
                      onClick={() => setStrat(id)} title={hint}
                      style={{
                        padding: '5px 12px', fontSize: '12.5px', cursor: 'pointer',
                        borderRadius: '4px', letterSpacing: '0.06em',
                        border: `1px solid ${strat === id ? 'var(--magenta)' : 'var(--border)'}`,
                        background: strat === id
                          ? 'color-mix(in srgb, var(--magenta) 16%, transparent)' : 'transparent',
                        color: strat === id ? 'var(--text)' : 'var(--muted)',
                        fontWeight: strat === id ? 700 : 400,
                      }}>
                {label}
              </button>
            ))}
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: '12px', color: 'var(--muted)', maxWidth: '46ch',
              lineHeight: 1.6 }}>
              A signal is what a rule says now; a backtest is the same rule over years. Both are
              strategising.
            </span>
          </div>
        )}

        {tab === 'strategise' && strat === 'build' && (
          <StrategyBuilder currentUser={currentUser} canRequest={canRequest}
                           symbol={sym} exchange={exchange} interval={barInterval}
                           capital={capital} riskPct={riskPct} />
        )}

        {tab === 'strategise' && strat === 'why' && (
          <WhyPanel currentUser={currentUser} symbol={sym} exchange={exchange}
                    thesis={held?.thesis || null} />
        )}

        {/* PROJECTION MOVED HERE FROM THE CHART HEADER (Section 105), at master's instruction. It is a
            forward view, which makes it a strategy question rather than a chart setting — and it still
            draws on THE SAME CHART, which is what he asked for: the cone renders under CHART whenever
            it is switched on here. */}
        {tab === 'strategise' && strat === 'projection' && (
          <div className="hud-card" style={{ padding: '16px', display: 'flex',
            flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <div className="section-label">PROJECTION</div>
              <InfoTip id="projection" />
              <span style={{ flex: 1 }} />
              <label style={{ fontSize: '12.5px', color: 'var(--text)', display: 'flex',
                gap: '6px', alignItems: 'center', cursor: 'pointer' }}>
                <input type="checkbox" checked={coneOn}
                       onChange={e => setConeOn(e.target.checked)} />
                draw it on the chart
              </label>
            </div>
            <div style={{ fontSize: '12.5px', color: 'var(--text-dim, var(--muted))',
              lineHeight: 1.75, maxWidth: '80ch' }}>
              This draws the range {sym}&rsquo;s own volatility calls ordinary over the horizon —
              <strong> not a forecast of direction</strong>. When no model has cleared the acceptance
              gate the centre line stays flat and grey, meaning &ldquo;last price extended&rdquo;
              rather than &ldquo;we expect no change&rdquo;. Switch it on and open the CHART tab: it
              renders on the same chart rather than a second copy of one.
            </div>
            {cone?.error && (
              <div style={{ fontSize: '12.5px', color: 'var(--amber)' }}>
                Unavailable: {cone.error}
              </div>
            )}
            {cone && cone.ok === false && (
              <div style={{ fontSize: '12.5px', color: 'var(--muted)' }}>
                Unavailable: {cone.reason}
              </div>
            )}
            {cone?.ok && (
              <>
                <div style={{ display: 'flex', gap: '18px', flexWrap: 'wrap' }}>
                  <Stat label="CENTRE" info="coneTilted"
                        value={cone.tilted ? 'MODEL-TILTED' : 'FLAT'}
                        color={cone.tilted ? 'var(--accent)' : 'var(--muted)'} />
                  <Stat label="HORIZON" info="horizon" value={cone.horizon || '—'} />
                  <Stat label="BARS AHEAD" value={String((cone.points || []).length || '—')} />
                </div>
                <div style={{ fontSize: '12.5px', color: 'var(--text-dim, var(--muted))',
                  lineHeight: 1.7 }}>
                  {cone.summary?.text}{' '}
                  <span style={{ color: cone.tilted ? 'var(--accent)' : 'var(--muted)' }}>
                    {cone.tiltReason}
                  </span>
                </div>
                <div>
                  <button className="btn btn-sm" onClick={() => setTab('chart')}>
                    show it on the chart →
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* THE SIGNALS TAB RENDERED NOTHING AT ALL before a request (Section 102): the whole block
            was gated on `result`, so clicking the tab gave master a blank page with no explanation
            and no way to tell it apart from a crash. */}
        {tab === 'strategise' && strat === 'now' && !result && (
          <div className="hud-card" style={{ padding: '20px', display: 'flex',
            flexDirection: 'column', gap: '10px', alignItems: 'flex-start' }}>
            <div className="section-label">SIGNALS</div>
            <div style={{ fontSize: '12.5px', color: 'var(--muted)', lineHeight: 1.7,
              maxWidth: '62ch' }}>
              No signals yet for {sym}. A signal is a request, not a feed — Rāma does not generate
              them in the background, because a stale entry price is worse than none.
              {cannotPredict && <><br /><span style={{ color: 'var(--amber)' }}>{cannotPredict}</span></>}
            </div>
            <button className="btn btn-primary" disabled={!!cannotPredict}
                    title={cannotPredict || 'Ask the engine for signals on this instrument'}
                    onClick={runPredict}>
              {status === 'requesting' ? 'Requesting…' : `⚡ Generate signals for ${sym}`}
            </button>
          </div>
        )}

        {tab === 'strategise' && strat === 'now' && result && (
          <div className="hud-card" style={{ padding: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px', flexWrap: 'wrap' }}>
              <div className="section-label">SIGNALS — {result.symbol} ({result.exchange})</div>
              <span className={`badge ${dataIsMock ? 'badge-amber' : 'badge-green'}`}
                    style={{ display: 'inline-flex', alignItems: 'center' }}>
                {dataIsMock ? 'MOCK DATA — INDICATIVE ONLY' : 'REAL OHLCV'}
                <InfoTip id="mockData" />
              </span>
              {result.suppressedCount > 0 && (
                <span className="badge badge-amber"
                      style={{ display: 'inline-flex', alignItems: 'center' }}>
                  {result.suppressedCount} SUPPRESSED<InfoTip id="suppressed" />
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
                      {/* Each abbreviation carries its own definition (Section 104). Ten short heads
                          with the meanings only in a paragraph below is a table you have to look away
                          from to read. */}
                      {/* T2 and T3 share `targets` with T1, so only T1 carries the marker — three
                          identical `?` in a row is clutter, not help. */}
                      {[['SETUP', 'setup'], ['DIR', 'directionType'], ['ENTRY', 'entryPrice'],
                        ['SL', 'stopLoss'], ['T1', 'targets'], ['T2', null], ['T3', null],
                        ['R:R', 'riskReward'], ['PROB', 'probability'], ['GRADE', 'grade']]
                        .map(([h, info], i) => (
                          <th key={h} style={{
                            padding: '7px 9px', fontSize: '12.5px', color: 'var(--muted)',
                            textAlign: i === 0 ? 'left' : i >= 2 && i <= 6 ? 'right' : 'center',
                            whiteSpace: 'nowrap',
                          }}>
                            <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                              {h}{info && <InfoTip id={info} side={i > 6 ? 'left' : 'right'} />}
                            </span>
                          </th>
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
                {/* CLICKING A ROW PUT LEVELS ON A CHART THAT IS ON ANOTHER TAB, so the feedback for
                    the action was invisible (Section 102). The selection is now confirmed here, with
                    a way to go and look. */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '8px',
                  flexWrap: 'wrap', fontSize: '12px', color: 'var(--muted)' }}>
                  <span style={{ maxWidth: '62ch', lineHeight: 1.6 }}>
                    Each row is a different risk geometry over <strong>one</strong> prediction — not
                    {' '}{signals.length} independent forecasts. Column meanings: ENTRY/SL/T1–T3 are
                    price levels, R:R is reward divided by risk, PROB is the modelled chance of
                    reaching T1, GRADE is the engine's own confidence band.
                  </span>
                  <span style={{ flex: 1 }} />
                  {selected && (
                    <button type="button" className="btn btn-sm" onClick={() => setTab('chart')}>
                      show {selected.variant || `#${selected.rank}`} on the chart →
                    </button>
                  )}
                </div>
              </>
            ) : (
              <div style={{ color: 'var(--muted)', fontSize: '12px', padding: '12px' }}>No signals returned.</div>
            )}

            {/* Why — straight from the ensemble */}
            {selected && Array.isArray(selected.reasons) && selected.reasons.length > 0 && (
              <div style={{ marginTop: '14px', paddingTop: '12px', borderTop: '1px solid var(--border)' }}>
                <div className="section-label" style={{ marginBottom: '8px', display: 'flex',
                  alignItems: 'center', gap: '6px' }}>
                  WHY — {selected.variant || `#${selected.rank}`}
                  <InfoTip id="reasons" />
                </div>
                <div style={{ display: 'flex', gap: '18px', flexWrap: 'wrap', marginBottom: '10px' }}>
                  <Stat label="DIRECTIONAL" value={pct(selected.directionalProbability)}
                        info="directionalProbability" />
                  <Stat label="T1 / T2 / T3" info="targets"
                        value={`${pct(selected.t1Probability)} / ${pct(selected.t2Probability)} / ${pct(selected.t3Probability)}`} />
                  <Stat label="SL RISK" value={pct(selected.slProbability)} color="var(--red)"
                        info="slProbability" />
                  <Stat label="REGIME" value={selected.regime || '—'} info="regime" />
                  <Stat label="AGREEMENT" value={num(selected.modelAgreement, 2)}
                        info="modelAgreement" />
                  <Stat label="UNCERTAINTY" value={num(selected.uncertainty, 3)} info="uncertainty" />
                  <Stat label="MAX RISK" value={selected.maxRisk != null ? String(selected.maxRisk) : '—'}
                        info="maxRisk" />
                  <Stat label="VALID FOR" value={selected.validityBars != null ? `${selected.validityBars} bars` : '—'}
                        info="validityBars" />
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
              <Stat label="PCR (OI)" value={num(latestDeriv.pcr_oi, 3)} info="pcrOi" />
              <Stat label="MAX PAIN" value={num(latestDeriv.max_pain, 0)} info="maxPain" />
              <Stat label="SUPPORT" value={num(latestDeriv.max_pe_oi_strike, 0)} color="var(--green)"
                    info="oiSupportResistance" />
              <Stat label="RESISTANCE" value={num(latestDeriv.max_ce_oi_strike, 0)} color="var(--red)"
                    info="oiSupportResistance" />
              <Stat label="FUT BASIS" info="futBasis" value={latestDeriv.fut_basis_pct != null
                    ? `${(latestDeriv.fut_basis_pct * 100).toFixed(2)}%` : '—'} />
              <Stat label="ROLLOVER" info="rollover" value={latestDeriv.rollover_pct != null
                    ? `${(latestDeriv.rollover_pct * 100).toFixed(1)}%` : '—'} />
              <Stat label="EXPECTED MOVE" info="expectedMove" value={latestDeriv.straddle_pct != null
                    ? `${(latestDeriv.straddle_pct * 100).toFixed(2)}%` : '—'} />
              <Stat label="DAYS TO EXPIRY" info="daysToExpiry" value={latestDeriv.days_to_expiry != null
                    ? String(latestDeriv.days_to_expiry) : '—'} />
            </div>
          </div>
        )}

        {/* News */}
        {tab === 'engine' && news && (
          <div className="hud-card" style={{ padding: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px', flexWrap: 'wrap' }}>
              <div className="section-label">NEWS — {sym}</div>
              <span className="badge badge-amber"
                    style={{ display: 'inline-flex', alignItems: 'center' }}>
                NOT BACKTESTABLE<InfoTip id="newsNotBacktestable" />
              </span>
              {news.aggregate && (
                <>
                  <Stat label="SENTIMENT" info="sentiment" value={num(news.aggregate.sentiment, 3)}
                        color={news.aggregate.sentiment > 0.05 ? 'var(--green)'
                          : news.aggregate.sentiment < -0.05 ? 'var(--red)' : 'var(--muted)'} />
                  <Stat label="POS / NEG"
                        value={`${news.aggregate.positive} / ${news.aggregate.negative}`} />
                  <Stat label="EVENT" info="dominantEvent"
                        value={news.aggregate.dominantEvent || '—'} />
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

      {/* ── Disclaimer — non-removable per spec, now a fixed footer (Section 98) ──
          Master asked for it at the bottom. Placed OUTSIDE the scrolling region rather than at the
          end of it: inside the scroll it would only be visible after scrolling past everything, which
          for a non-removable legal notice is worse than where it was. As a footer it is both at the
          bottom and always on screen.

          `flexShrink: 0` so a long signal list cannot squeeze it away. */}
      <footer style={{
        flexShrink: 0,
        padding: '9px 20px',
        background: 'rgba(255,170,0,0.05)',
        borderTop: '1px solid rgba(255,170,0,0.28)',
        fontSize: '11.5px', color: 'var(--amber)', lineHeight: 1.6,
      }}>
        ⚠ StockMind provides AI-generated market analysis for informational purposes only. Not
        financial advice. Past performance does not guarantee future results. All signals carry
        inherent risk of loss. Human judgment required for all trading decisions.
      </footer>
    </div>
  );
}

