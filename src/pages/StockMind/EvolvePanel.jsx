import React, { useCallback, useEffect, useRef, useState } from 'react';
import InfoTip from './InfoTip.jsx';
import { FS, LH } from '@config/type.js';
import {
  runView, bookEntryView, bookSummary, shouldRefreshOnOpen, evolveRequest, whyCannotEvolve,
} from './evolveModel.js';

/**
 * EvolvePanel - choose the parameters, and let Rāma find, judge, keep, re-test and read out strategies
 * (spec Section 151).
 *
 * Master: *"evolving strategies tab - reduce the work on master. Suggestions of well calculated strategies
 * for various items in the stock market based on selection of params, and that can be stored, updated and
 * utilised."*
 *
 * WHAT MASTER DOES: picks the instrument, the interval, capital, risk and direction (all already on the
 * page), presses EVOLVE, and presses KEEP on what he wants to follow. What Rāma does: tries every published
 * strategy, tunes each only on the past, scores it only on what came after, ranks what pays after costs,
 * re-tests the kept ones on bars that arrived since, and says what each rule reads now.
 *
 * WHAT THIS SCREEN WILL NOT DO
 *   - Call a profitable row good. Profit gates the list (Section 135) but only DEMONSTRATED earns a green
 *     label; the rest say NOT DEMONSTRATED in amber, on the card, every time.
 *   - Keep anything on its own. EVOLVE stores nothing. KEEP is a click.
 *   - Retire anything on its own. A decaying strategy is PROPOSED for retirement; the button is master's.
 *   - Run on a timer. The only automatic act is refreshing a stale book when the tab opens, decided in one
 *     place (`shouldRefreshOnOpen`), and only for a user who may request.
 *   - Tell master to buy or sell. A rule's state is described: flat, conditions met, in a trade.
 */

const inBridge = typeof window !== 'undefined' && !!window.rama?.marketIntel;

const TONE_BADGE = { good: 'badge badge-green', warn: 'badge badge-amber', bad: 'badge badge-red', muted: 'badge' };
const TONE_COLOR = { good: 'var(--green)', warn: 'var(--gold)', bad: 'var(--red)', muted: 'var(--muted)' };

function Pill({ tone, children, title }) {
  return (
    <span className={TONE_BADGE[tone] || 'badge'} title={title}
          style={tone === 'muted' ? { color: 'var(--muted)' } : undefined}>
      {children}
    </span>
  );
}

function Fact({ label, children }) {
  return (
    <div style={{ minWidth: '110px' }}>
      <div style={{ fontSize: FS.dense, color: 'var(--muted)' }}>{label}</div>
      <div style={{ fontSize: FS.denseLg, color: 'var(--text)', lineHeight: LH.chrome }}>{children}</div>
    </div>
  );
}

function Column({ col }) {
  return (
    <div style={{ flex: '1 1 210px', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '8px 10px' }}>
      <div style={{ fontSize: FS.dense, color: 'var(--muted)', marginBottom: '4px' }}>
        {col.title} · {col.on}
      </div>
      <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap' }}>
        <Fact label="Hit rate">{col.hitRate}</Fact>
        <Fact label="Trades">{col.trades}</Fact>
        <Fact label="Per trade">{col.expectancy}</Fact>
      </div>
      {col.bars && col.bars !== '—' && (
        <div style={{ fontSize: FS.dense, color: 'var(--muted)', marginTop: '4px' }}>{col.bars}</div>
      )}
      {col.note && (
        <div style={{ fontSize: FS.dense, color: 'var(--muted)', marginTop: '4px', lineHeight: LH.chrome }}>{col.note}</div>
      )}
    </div>
  );
}

export default function EvolvePanel({ currentUser, canRequest, symbol, exchange, interval, capital, riskPct }) {
  const [side, setSide] = useState('both');
  const [wider, setWider] = useState(false);
  const [run, setRun] = useState(null);
  const [busy, setBusy] = useState(false);
  const [book, setBook] = useState(null);
  const [signals, setSignals] = useState({});
  const [bookBusy, setBookBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [showRefused, setShowRefused] = useState(false);
  const [showRetired, setShowRetired] = useState(false);
  const openedRef = useRef(false);

  const user = currentUser;

  const loadBook = useCallback(async (retired = showRetired) => {
    if (!inBridge) return null;
    const res = await window.rama.marketIntel.bookList({ user, includeRetired: retired });
    if (res?.ok === false) { setMessage(res.error || res.reason || 'The book could not be read.'); return null; }
    const view = res.data || null;
    if (view && view.ok === false) {
      setMessage(view.corrupt ? `The strategy book file could not be read and was left untouched: ${view.reason}` : view.reason);
      setBook(null);
      return null;
    }
    setBook(view);
    const sg = await window.rama.marketIntel.bookSignals({ user });
    const map = {};
    for (const s of (sg?.data?.signals || [])) map[s.id] = s;
    setSignals(map);
    return view;
  }, [user, showRetired]);

  // Opening the tab reads the book and, if some are stale and this user may request, refreshes them. This is
  // the ONLY automatic act on this screen, and it happens once per mount.
  useEffect(() => {
    if (!inBridge || openedRef.current) return undefined;
    openedRef.current = true;
    let live = true;
    (async () => {
      const view = await loadBook();
      if (!live || !view) return;
      if (shouldRefreshOnOpen({ canRequest, inBridge, staleIds: view.staleIds, busy: false })) {
        setBookBusy(true);
        const r = await window.rama.marketIntel.bookRefresh({ user, onlyStale: true });
        if (!live) return;
        setBookBusy(false);
        if (r?.ok === false) setMessage(r.error || r.reason);
        else if (r?.data?.proposeRetire?.length) {
          setMessage(`${r.data.proposeRetire.length} kept ${r.data.proposeRetire.length === 1 ? 'strategy has' : 'strategies have'} stopped paying since you kept ${r.data.proposeRetire.length === 1 ? 'it' : 'them'}. Review below; nothing was retired.`);
        }
        await loadBook();
      }
    })();
    return () => { live = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const why = whyCannotEvolve({ inBridge, canRequest, busy, symbol });

  const evolve = useCallback(async () => {
    const req = evolveRequest({ symbol, exchange, interval, capital, riskPct, side, wider });
    if (!req.ok) { setMessage(req.reason); return; }
    setBusy(true);
    setMessage(null);
    setRun(null);
    const res = await window.rama.marketIntel.strategyEvolve({ user, ...req.body });
    setBusy(false);
    if (res?.ok === false) { setRun({ ok: false, reason: res.error || res.reason }); return; }
    setRun(res.data || null);
  }, [symbol, exchange, interval, capital, riskPct, side, wider, user]);

  const keep = useCallback(async (opts) => {
    if (!run?.runId) return;
    setBookBusy(true);
    const res = await window.rama.marketIntel.bookKeep({ user, runId: run.runId, ...opts });
    setBookBusy(false);
    const d = res?.data || res || {};
    if (res?.ok === false || d.ok === false) {
      setMessage(d.reason || res.error || 'Nothing was kept.');
      return;
    }
    const n = (d.kept || []).length;
    setMessage(n === 0 ? (d.note || 'Nothing was kept.') : `Kept ${n}. ${(d.kept || []).some((k) => k.action === 'updated') ? 'Some were already in the book and were updated.' : ''}`.trim());
    await loadBook();
  }, [run, user, loadBook]);

  // call is a closure over a LITERAL bridge member, so every channel this panel uses is visible to the
  // reachability audit by name rather than hidden behind a computed key.
  const act = useCallback(async (call, done) => {
    setBookBusy(true);
    const res = await call();
    setBookBusy(false);
    const d = res?.data || res || {};
    if (res?.ok === false || d.ok === false) { setMessage(d.reason || res.error || 'That did not work.'); return; }
    if (done) setMessage(done);
    await loadBook();
  }, [user, loadBook]);

  const refreshNow = () => act(() => window.rama.marketIntel.bookRefresh({ user, onlyStale: false }), 'Re-tested on the bars that arrived since each was kept.');

  if (!inBridge) {
    return <div style={{ fontSize: FS.denseLg, color: 'var(--muted)' }}>Evolving strategies needs the Rāma desktop app.</div>;
  }

  const rv = run ? runView(run) : null;
  const entries = (book?.strategies || []).map((e) => bookEntryView(e, signals[e.id]));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>

      {/* ── Choose, then evolve ───────────────────────────────────────────── */}
      <div className="hud-card" style={{ padding: '14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <div className="section-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            EVOLVE STRATEGIES<InfoTip id="evolve" />
          </div>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: FS.dense, color: 'var(--muted)' }}>
            {symbol} · {interval} · {exchange} · capital {Number(capital).toLocaleString('en-IN')} · risk {riskPct}% a trade
          </span>
        </div>
        <div style={{ fontSize: FS.denseLg, color: 'var(--muted)', lineHeight: LH.body }}>
          Rāma tries every published strategy on this instrument, tunes each only on the past, scores it only on what
          came after, and ranks what pays after costs. Nothing is saved until you keep it.
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <label style={{ fontSize: FS.denseLg, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: '6px' }}>
            Direction
            <select className="input" value={side} onChange={(e) => setSide(e.target.value)} aria-label="Direction" style={{ width: '120px' }}>
              <option value="both">long and short</option>
              <option value="long">long only</option>
              <option value="short">short only</option>
            </select>
          </label>
          <label style={{ fontSize: FS.denseLg, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <input type="checkbox" checked={wider} onChange={(e) => setWider(e.target.checked)} />
            Search wider<InfoTip id="exploreWider" />
          </label>
          <span style={{ flex: 1 }} />
          <button type="button" className="btn btn-primary" onClick={evolve} disabled={!!why} title={why || 'Run the search'}>
            {busy ? 'EVOLVING…' : 'EVOLVE'}
          </button>
        </div>
        {why && <div style={{ fontSize: FS.dense, color: 'var(--muted)' }}>{why}</div>}
        {busy && (
          <div role="status" style={{ fontSize: FS.denseLg, color: 'var(--muted)' }}>
            Judging each strategy over {symbol}'s stored history. This can take a few minutes on a long series.
          </div>
        )}
        {message && <div role="status" style={{ fontSize: FS.denseLg, color: 'var(--text)' }}>{message}</div>}
      </div>

      {/* ── The result ────────────────────────────────────────────────────── */}
      {rv && !rv.ok && (
        <div className="hud-card" style={{ padding: '14px', fontSize: FS.denseLg, color: 'var(--text)', lineHeight: LH.body }}>
          {rv.reason}
        </div>
      )}

      {rv && rv.ok && (
        <div className="hud-card" style={{ padding: '14px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ fontSize: FS.chrome, color: 'var(--text)', lineHeight: LH.body }}>{rv.headline}</div>
          <div style={{ fontSize: FS.dense, color: 'var(--muted)', lineHeight: LH.chrome }}>
            {rv.window} {rv.familyTrials} {rv.cost}
          </div>

          {rv.ranked.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: FS.dense, color: 'var(--muted)' }}>Ranked by hit rate on bars it was not tuned on, among those that pay after costs.</span>
              <span style={{ flex: 1 }} />
              {rv.canKeepAll && canRequest && (
                <button type="button" className="btn btn-sm btn-primary" disabled={bookBusy}
                        onClick={() => keep({ demonstrated: true })}>
                  KEEP DEMONSTRATED ({rv.nDemonstrated})<InfoTip id="keepStrategy" />
                </button>
              )}
            </div>
          )}

          {rv.ranked.map((c) => (
            <div key={c.id} style={{ border: `1px solid ${c.tone === 'good' ? 'var(--green)' : 'var(--border)'}`, borderRadius: 'var(--radius)', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                <strong style={{ fontSize: FS.chrome, color: 'var(--text)' }}>#{c.rank} {c.name}</strong>
                <Pill tone={c.tone} title={c.sentence}>{c.label}</Pill>
                {c.klass === 'demonstrated' ? <InfoTip id="demonstrated" /> : <InfoTip id="notDemonstrated" />}
                <span style={{ flex: 1 }} />
                {canRequest && (
                  <button type="button" className="btn btn-sm" disabled={bookBusy} onClick={() => keep({ ids: [c.id] })}>
                    {c.keepLabel}
                  </button>
                )}
              </div>
              <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                <Fact label="Hit rate (after tuning)">{c.hitRate}</Fact>
                <Fact label="Trades">{c.trades}</Fact>
                <Fact label="Per trade">{c.expectancy}</Fact>
                <Fact label="Reward to risk">{c.payoff}</Fact>
                <Fact label="Deepest drop">{c.drawdown}</Fact>
                <Fact label="Chance">{c.chanceReal}</Fact>
              </div>
              <div style={{ fontSize: FS.denseLg, color: TONE_COLOR[c.tone], lineHeight: LH.body }}>{c.sentence}</div>
              <div style={{ fontSize: FS.dense, color: 'var(--muted)', lineHeight: LH.chrome, display: 'flex', flexDirection: 'column', gap: '2px' }}>
                {c.selectionNoise && <span>{c.selectionNoise}<InfoTip id="selectionNoise" /></span>}
                {c.folds && <span>{c.folds}<InfoTip id="walkForward" /></span>}
                {c.gap && <span>{c.gap}</span>}
                {c.trials && <span>{c.trials}</span>}
                {c.fallbacks && <span>{c.fallbacks}</span>}
                {c.breakeven && <span>It {c.breakeven}.</span>}
                {c.claim && <span>{c.claim}</span>}
                <span>{c.disclaimer}</span>
              </div>
            </div>
          ))}

          {rv.refused.length > 0 && (
            <div>
              <button type="button" className="btn btn-sm" onClick={() => setShowRefused((v) => !v)} aria-expanded={showRefused}>
                {showRefused ? 'HIDE' : 'SHOW'} {rv.refused.length} NOT RANKED
              </button>
              {showRefused && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' }}>
                  {rv.refused.map((x) => (
                    <div key={x.id} style={{ borderLeft: '2px solid var(--border)', paddingLeft: '10px', fontSize: FS.denseLg, lineHeight: LH.body }}>
                      <strong style={{ color: 'var(--text)' }}>{x.name}</strong>
                      <span style={{ color: 'var(--muted)' }}> · {x.title}</span>
                      <div style={{ color: 'var(--muted)' }}>{x.why}</div>
                      {x.history && <div style={{ color: 'var(--muted)' }}>{x.history}<InfoTip id="historyNeeded" /></div>}
                    </div>
                  ))}
                  {rv.refusedTemplates.map((t) => (
                    <div key={t} style={{ fontSize: FS.dense, color: 'var(--muted)' }}>Could not be run: {t}</div>
                  ))}
                </div>
              )}
            </div>
          )}
          {rv.notes.length > 0 && (
            <div style={{ fontSize: FS.dense, color: 'var(--muted)', lineHeight: LH.chrome }}>
              {rv.notes.map((n) => <div key={n}>{n}</div>)}
            </div>
          )}
        </div>
      )}

      {/* ── The book ──────────────────────────────────────────────────────── */}
      <div className="hud-card" style={{ padding: '14px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <div className="section-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            YOUR STRATEGY BOOK<InfoTip id="strategyBook" />
          </div>
          <span style={{ fontSize: FS.denseLg, color: 'var(--muted)' }}>{bookSummary(book)}</span>
          <span style={{ flex: 1 }} />
          <label style={{ fontSize: FS.dense, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <input type="checkbox" checked={showRetired}
                   onChange={(e) => { setShowRetired(e.target.checked); loadBook(e.target.checked); }} />
            show retired
          </label>
          {canRequest && entries.length > 0 && (
            <button type="button" className="btn btn-sm" disabled={bookBusy} onClick={refreshNow}>
              {bookBusy ? 'TESTING…' : 'RE-TEST ON NEWER BARS'}<InfoTip id="forwardTest" />
            </button>
          )}
        </div>

        {entries.map((v) => (
          <div key={v.id} style={{ border: `1px solid ${v.status === 'decaying' ? 'var(--red)' : 'var(--border)'}`, borderRadius: 'var(--radius)', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '8px', opacity: v.status === 'retired' ? 0.7 : 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <strong style={{ fontSize: FS.chrome, color: 'var(--text)' }}>{v.name}</strong>
              <span style={{ fontSize: FS.dense, color: 'var(--muted)' }}>{v.where}</span>
              <Pill tone={v.statusTone} title={v.statusSentence}>{v.statusLabel}</Pill>
              <InfoTip id="bookStatus" />
              <Pill tone={v.classTone}>{v.classLabel}</Pill>
              <span style={{ flex: 1 }} />
              {canRequest && v.status !== 'retired' && (
                <button type="button" className="btn btn-sm" disabled={bookBusy}
                        onClick={() => act(() => window.rama.marketIntel.bookRetire({ user, id: v.id, reason: 'retired by master' }), 'Retired. It stays in the history.')}>RETIRE</button>
              )}
              {canRequest && v.status === 'retired' && (
                <button type="button" className="btn btn-sm" disabled={bookBusy}
                        onClick={() => act(() => window.rama.marketIntel.bookRestore({ user, id: v.id }), 'Restored to watch.')}>RESTORE</button>
              )}
              {canRequest && (
                <button type="button" className="btn btn-sm btn-danger" disabled={bookBusy}
                        onClick={() => { if (window.confirm(`Delete "${v.name}" from the book? Retiring keeps the history; deleting does not.`)) act(() => window.rama.marketIntel.bookRemove({ user, id: v.id }), 'Deleted.'); }}>DELETE</button>
              )}
            </div>

            {v.retireProposal && (
              <div role="alert" style={{ fontSize: FS.denseLg, color: 'var(--red)', borderLeft: '2px solid var(--red)', paddingLeft: '8px', lineHeight: LH.body }}>
                {v.retireProposal}
              </div>
            )}

            {/* What the rule says now - a description of the rule, never an instruction. */}
            <div style={{ borderLeft: '2px solid var(--accent)', paddingLeft: '8px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <Pill tone={v.signal.state === 'conditions-met' || v.signal.state === 'in-trade' ? 'warn' : 'muted'}>{v.signal.label}</Pill>
                <InfoTip id="signalState" />
                <span style={{ fontSize: FS.denseLg, color: 'var(--text)', lineHeight: LH.body }}>{v.signal.text}</span>
              </div>
              {v.signal.levels && <div style={{ fontSize: FS.denseLg, color: 'var(--text)' }}>{v.signal.levels}</div>}
              {v.signal.sizing && <div style={{ fontSize: FS.dense, color: 'var(--muted)' }}>{v.signal.sizing}</div>}
              {v.signal.age && (
                <div style={{ fontSize: FS.dense, color: v.signal.stale ? 'var(--gold)' : 'var(--muted)' }}>{v.signal.age}</div>
              )}
            </div>

            {/* Claim, baseline and current: three things, never merged. */}
            <div style={{ fontSize: FS.dense, color: 'var(--muted)', lineHeight: LH.chrome }}>{v.claim}</div>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <Column col={v.baseline} />
              <Column col={v.current} />
            </div>
            <div style={{ fontSize: FS.dense, color: 'var(--muted)' }}>{v.statusSentence}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
