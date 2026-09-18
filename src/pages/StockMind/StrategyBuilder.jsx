import React, { useCallback, useEffect, useMemo, useState } from 'react';

/**
 * StrategyBuilder — pick the parts, see what the search costs, judge the result, take the Python.
 *
 * Master: *"strategies can be made individually or various combo of probability calculation +
 * higherhigh-lowerlow (trend lines) + technical indicators + various things (news + sentiment) etc., so
 * we need to have ability to pick things, backtest them for various scenarios → converting to code
 * mostly Python to execute strategy based on the investment, ROI, risk."*
 *
 * See spec Section 103. The decisions this component has to hold up:
 *
 * THE TRIAL COUNT IS SHOWN WHILE MASTER IS STILL CHOOSING, not afterwards. `strategy_eval` raises the
 * bar a result must clear in proportion to how many variants were searched, so the count is the most
 * important number on the screen — and it is useless after the fact. A sweep of three periods by four
 * stops is twelve variants, and twelve is a different question from one.
 *
 * BLOCKS THAT CANNOT BE BACKTESTED ARE SHOWN, PICKABLE, AND REFUSED. Model probability is look-ahead
 * against historical bars; news has no free history. Both are offered for a live strategy and both make
 * the backtest refuse with the reason. Hiding them would be a lie of omission about what StockMind can
 * measure; including them quietly would be the other kind.
 *
 * ROI IS REPORTED, NEVER REQUESTED. There is no target-return field, because a search that keeps going
 * until something clears a target will always find something in the noise.
 *
 * THE VERDICT IS THE HEADLINE, not the return. A strategy that made 40% on the search window and failed
 * the holdout has failed, and the layout says so in that order.
 */

const inBridge = typeof window !== 'undefined' && !!window.rama?.marketIntel;

const money = (v) => (typeof v === 'number' && Number.isFinite(v)
  ? v.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—');
const signed = (v) => (typeof v === 'number' && Number.isFinite(v)
  ? `${v >= 0 ? '+' : ''}${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '—');
const dec = (v, dp = 2) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(dp) : '—');
const pnlColor = (v) => (typeof v !== 'number' || !Number.isFinite(v) ? 'var(--muted)'
  : v > 0 ? 'var(--green)' : v < 0 ? 'var(--red)' : 'var(--text)');

function Field({ label, hint, children }) {
  return (
    <div>
      <div style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '3px' }}>{label}</div>
      {children}
      {hint && <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '2px' }}>{hint}</div>}
    </div>
  );
}

export default function StrategyBuilder({ currentUser, canRequest, symbol, exchange, interval,
  capital, riskPct }) {
  const [catalogue, setCatalogue] = useState(null);
  const [catError, setCatError] = useState(null);
  const [picked, setPicked] = useState([]);           // [{ id, params, sweep: {param: [values]} }]
  const [combiner, setCombiner] = useState('all');
  const [atLeastK, setAtLeastK] = useState(2);
  const [side, setSide] = useState('long');
  const [name, setName] = useState('My strategy');
  const [stopPct, setStopPct] = useState('2');
  const [targetPct, setTargetPct] = useState('4');
  const [maxBars, setMaxBars] = useState('10');
  const [validation, setValidation] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState(null);
  const [codeBusy, setCodeBusy] = useState(false);
  const [openGroup, setOpenGroup] = useState(null);

  useEffect(() => {
    if (!inBridge) return;
    let live = true;
    (async () => {
      const res = await window.rama.marketIntel.strategyBlocks({ user: currentUser });
      if (!live) return;
      if (res?.ok === false) { setCatError(res.error || 'Could not read the block catalogue'); return; }
      setCatalogue(res.data || null);
      setOpenGroup(res.data?.groups?.[0]?.group || null);
    })();
    return () => { live = false; };
  }, [currentUser]);

  const blockById = useMemo(() => {
    const m = new Map();
    for (const g of catalogue?.groups || []) for (const b of g.blocks) m.set(b.id, b);
    return m;
  }, [catalogue]);

  // The spec, assembled from the form. Kept as a derived value so there is exactly one definition of
  // what is about to be tested — a separate "current spec" state would drift from the controls.
  const spec = useMemo(() => {
    const sweep = {};
    picked.forEach((p, idx) => {
      for (const [param, values] of Object.entries(p.sweep || {})) {
        if (Array.isArray(values) && values.length > 1) sweep[`${idx}.${param}`] = values;
      }
    });
    return {
      name,
      symbol, exchange, interval, side,
      entry: {
        op: combiner, k: Number(atLeastK) || 1,
        blocks: picked.map((p) => ({ id: p.id, params: p.params })),
      },
      exit: {
        stopPct: stopPct === '' ? null : Number(stopPct),
        targetPct: targetPct === '' ? null : Number(targetPct),
        maxBars: Number(maxBars) || 0,
      },
      sizing: { capital: Number(capital) || 0, riskPct: Number(riskPct) || 0 },
      sweep,
    };
  }, [name, symbol, exchange, interval, side, combiner, atLeastK, picked,
    stopPct, targetPct, maxBars, capital, riskPct]);

  // Validate on every change. The trial count and the refusals are the point — master should not have
  // to press anything to learn that his configuration searches 4,096 variants.
  useEffect(() => {
    if (!inBridge) return;
    let live = true;
    const t = setTimeout(async () => {
      const res = await window.rama.marketIntel.strategyValidate({ user: currentUser, spec });
      if (!live) return;
      setValidation(res?.ok === false ? { error: res.error } : (res.data || null));
    }, 180);
    return () => { live = false; clearTimeout(t); };
  }, [spec, currentUser]);

  const addBlock = (b) => {
    const params = {};
    for (const [pname, pspec] of Object.entries(b.params)) params[pname] = pspec.default;
    setPicked((s) => s.concat({ id: b.id, params, sweep: {} }));
    setResult(null);
    setCode(null);
  };
  const removeBlock = (idx) => {
    setPicked((s) => s.filter((_, i) => i !== idx));
    setResult(null);
    setCode(null);
  };
  const setParam = (idx, pname, value) => {
    setPicked((s) => s.map((p, i) => (i === idx ? { ...p, params: { ...p.params, [pname]: value } } : p)));
    setResult(null);
  };
  const setSweep = (idx, pname, text) => {
    // Comma-separated, because a sweep is a small explicit set. A from/to/step control invites a
    // thousand-variant search by accident, and the whole point of showing the count is that the count
    // should be a decision.
    const values = String(text || '').split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n));
    setPicked((s) => s.map((p, i) => (i === idx
      ? { ...p, sweep: { ...p.sweep, [pname]: values } } : p)));
    setResult(null);
  };

  const runBacktest = useCallback(async () => {
    if (!inBridge) return;
    setBusy(true);
    setResult(null);
    setCode(null);
    const res = await window.rama.marketIntel.strategyBacktest({ user: currentUser, spec });
    setBusy(false);
    setResult(res?.ok === false ? { ok: false, reason: res.error } : (res.data || null));
  }, [spec, currentUser]);

  const generateCode = useCallback(async () => {
    if (!inBridge) return;
    setCodeBusy(true);
    const res = await window.rama.marketIntel.strategyCode({
      user: currentUser,
      spec: result?.spec || spec,
      verdict: result?.holdout || null,
      trials: result?.trials || validation?.trials || 1,
    });
    setCodeBusy(false);
    setCode(res?.ok === false ? { ok: false, reason: res.error } : (res.data || null));
  }, [result, spec, validation, currentUser]);

  const copyCode = async () => {
    try { await navigator.clipboard.writeText(code.code); } catch { /* no clipboard permission */ }
  };

  if (!inBridge) {
    return <div style={{ fontSize: '12.5px', color: 'var(--muted)' }}>
      The strategy builder needs the Rāma desktop app.
    </div>;
  }

  const trials = validation?.trials ?? 1;
  const blocked = validation?.blocked || [];
  const errors = validation?.errors || [];
  const warnings = validation?.warnings || [];
  const verdict = result?.holdout || null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>

      {/* ── Pick the parts ─────────────────────────────────────────────────── */}
      <div className="hud-card" style={{ padding: '14px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', marginBottom: '10px',
          flexWrap: 'wrap' }}>
          <div className="section-label">BUILD A STRATEGY</div>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)}
                 aria-label="Strategy name" style={{ width: '200px' }} />
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: '12px', color: 'var(--muted)' }}>
            {symbol} · {interval} · {exchange}
          </span>
        </div>

        {catError && <div style={{ fontSize: '12.5px', color: 'var(--red)' }}>{catError}</div>}

        {/* Groups are collapsed by default. Sixteen blocks laid flat is the density problem all over
            again; grouped by what each is evidence OF is how a trader already thinks about them. */}
        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginBottom: '8px' }}>
          {(catalogue?.groups || []).map((g) => (
            <button key={g.group} type="button"
                    onClick={() => setOpenGroup(openGroup === g.group ? null : g.group)}
                    aria-pressed={openGroup === g.group}
                    style={{
                      padding: '3px 10px', fontSize: '12px', cursor: 'pointer', borderRadius: '4px',
                      border: `1px solid ${openGroup === g.group ? 'var(--accent)' : 'var(--border)'}`,
                      background: openGroup === g.group
                        ? 'color-mix(in srgb, var(--accent) 16%, transparent)' : 'transparent',
                      color: openGroup === g.group ? 'var(--accent)' : 'var(--muted)',
                    }}>
              {g.group}
              {g.blocks.some((b) => !b.backtestable) && (
                <span style={{ color: 'var(--amber)' }} title="contains blocks a backtest refuses">
                  {' '}⚠
                </span>
              )}
            </button>
          ))}
        </div>

        {(catalogue?.groups || []).filter((g) => g.group === openGroup).map((g) => (
          <div key={g.group} style={{ display: 'flex', flexDirection: 'column', gap: '6px',
            paddingBottom: '8px' }}>
            {g.blocks.map((b) => (
              <div key={b.id} style={{ display: 'flex', alignItems: 'baseline', gap: '8px',
                fontSize: '12.5px', lineHeight: 1.6 }}>
                <button type="button" className="btn btn-sm" onClick={() => addBlock(b)}>+ add</button>
                <strong style={{ color: 'var(--text)', minWidth: '180px' }}>{b.label}</strong>
                {!b.backtestable && (
                  <span className="badge badge-amber" title={b.whyNotBacktestable}>
                    NOT BACKTESTABLE
                  </span>
                )}
                <span style={{ color: 'var(--muted)', flex: 1 }}>{b.explain}</span>
              </div>
            ))}
            {/* The reason is printed, not merely hoverable: it is the difference between a limitation
                master understands and one that looks like a bug. */}
            {g.blocks.filter((b) => !b.backtestable).map((b) => (
              <div key={`${b.id}-why`} style={{ fontSize: '12px', color: 'var(--amber)',
                borderLeft: '2px solid var(--amber)', paddingLeft: '8px', lineHeight: 1.6 }}>
                <strong>{b.label}:</strong> {b.whyNotBacktestable}
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* ── The chosen blocks, with their parameters and sweeps ────────────── */}
      <div className="hud-card" style={{ padding: '14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px',
          flexWrap: 'wrap' }}>
          <div className="section-label">ENTRY — {picked.length} block{picked.length === 1 ? '' : 's'}</div>
          <select className="input" style={{ width: '150px' }} value={combiner}
                  aria-label="How the blocks combine"
                  onChange={(e) => setCombiner(e.target.value)}>
            <option value="all">all must be true</option>
            <option value="any">any may be true</option>
            <option value="atLeast">at least k</option>
          </select>
          {combiner === 'atLeast' && (
            <input className="input" type="number" min="1" max={Math.max(1, picked.length)}
                   style={{ width: '70px' }} value={atLeastK} aria-label="k"
                   onChange={(e) => setAtLeastK(e.target.value)} />
          )}
          <select className="input" style={{ width: '110px' }} value={side}
                  aria-label="Trade direction"
                  onChange={(e) => setSide(e.target.value)}>
            <option value="long">long</option>
            <option value="short">short</option>
          </select>
        </div>

        {picked.length === 0 ? (
          <div style={{ fontSize: '12.5px', color: 'var(--muted)', lineHeight: 1.7 }}>
            Nothing picked yet. Add one block for a simple strategy, or several and combine them —
            a trend-structure block plus a momentum block plus a session filter is a different
            question from any one of them alone, which is the point of building it this way.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {picked.map((p, idx) => {
              const b = blockById.get(p.id);
              if (!b) return null;
              return (
                <div key={`${p.id}-${idx}`} style={{ border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)', padding: '9px 11px' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px',
                    marginBottom: '6px', flexWrap: 'wrap' }}>
                    <strong style={{ fontSize: '12.5px', color: 'var(--text)' }}>{b.label}</strong>
                    {!b.backtestable && (
                      <span className="badge badge-amber">NOT BACKTESTABLE</span>
                    )}
                    <span style={{ flex: 1 }} />
                    <button type="button" className="btn btn-sm"
                            onClick={() => removeBlock(idx)}>remove</button>
                  </div>
                  <div style={{ display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: '10px' }}>
                    {Object.entries(b.params).map(([pname, pspec]) => (
                      <Field key={pname} label={pname}
                             hint={pspec.type === 'enum' ? null
                               : `${pspec.min} to ${pspec.max}`}>
                        {pspec.type === 'enum' ? (
                          <select className="input" value={p.params[pname]}
                                  onChange={(e) => setParam(idx, pname, e.target.value)}>
                            {pspec.options.map((o) => <option key={o} value={o}>{o}</option>)}
                          </select>
                        ) : pspec.type === 'intset' ? (
                          <input className="input" value={(p.params[pname] || []).join(',')}
                                 onChange={(e) => setParam(idx, pname, String(e.target.value)
                                   .split(',').map((x) => Number(x.trim()))
                                   .filter((n) => Number.isFinite(n)))} />
                        ) : (
                          <input className="input" type="number"
                                 min={pspec.min} max={pspec.max}
                                 step={pspec.type === 'int' ? 1 : 0.1}
                                 value={p.params[pname]}
                                 onChange={(e) => setParam(idx, pname, Number(e.target.value))} />
                        )}
                        {/* A SWEEP IS A DELIBERATE ACT. Comma-separated values, so widening the
                            search is something master typed rather than something a range control
                            did for him — and the trial count below moves as he types. */}
                        {(pspec.type === 'int' || pspec.type === 'float') && (
                          <input className="input" style={{ marginTop: '3px', fontSize: '12px' }}
                                 placeholder="sweep: 10,20,30"
                                 aria-label={`Sweep values for ${pname}`}
                                 value={(p.sweep?.[pname] || []).join(',')}
                                 onChange={(e) => setSweep(idx, pname, e.target.value)} />
                        )}
                      </Field>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Exit and money ────────────────────────────────────────────────── */}
      <div className="hud-card" style={{ padding: '14px' }}>
        <div className="section-label" style={{ marginBottom: '10px' }}>EXIT AND MONEY</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))',
          gap: '10px' }}>
          <Field label="STOP %" hint="distance from entry">
            <input className="input" type="number" step="0.1" min="0" value={stopPct}
                   onChange={(e) => { setStopPct(e.target.value); setResult(null); }} />
          </Field>
          <Field label="TARGET %" hint="distance from entry">
            <input className="input" type="number" step="0.1" min="0" value={targetPct}
                   onChange={(e) => { setTargetPct(e.target.value); setResult(null); }} />
          </Field>
          <Field label="MAX BARS" hint="0 for no time limit">
            <input className="input" type="number" step="1" min="0" value={maxBars}
                   onChange={(e) => { setMaxBars(e.target.value); setResult(null); }} />
          </Field>
          <Field label="CAPITAL" hint="from the request form above">
            <input className="input" value={money(Number(capital))} readOnly />
          </Field>
          <Field label="RISK PER TRADE" hint="also from above">
            <input className="input" value={`${riskPct}%`} readOnly />
          </Field>
        </div>
        {/* There is deliberately NO target-ROI field. See Section 103: a search that runs until
            something clears a target will always find something in the noise. */}
        <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '8px', lineHeight: 1.6 }}>
          There is no target-return field, on purpose. A search that keeps going until something meets
          a target will always find something — in noise as readily as in an edge. Return is reported
          here, never requested.
        </div>
      </div>

      {/* ── What this search costs, before it runs ─────────────────────────── */}
      <div className="hud-card" style={{ padding: '14px', display: 'flex',
        flexDirection: 'column', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '14px', flexWrap: 'wrap' }}>
          <div className="section-label">BEFORE YOU RUN IT</div>
          <span style={{ fontSize: '13px', color: trials > 1 ? 'var(--amber)' : 'var(--text)',
            fontWeight: 700 }}>
            {trials.toLocaleString()} variant{trials === 1 ? '' : 's'}
          </span>
          <span style={{ fontSize: '12px', color: 'var(--muted)', maxWidth: '58ch',
            lineHeight: 1.6 }}>
            {trials === 1
              ? 'One configuration, specified in advance — the strongest form of evidence this tool can produce.'
              : 'Each extra variant raises the result the winner must beat, because the best of many '
                + 'noisy tries looks good whether or not an edge exists. A wider search makes a '
                + 'result harder to believe, not easier.'}
          </span>
        </div>

        {errors.length > 0 && (
          <div style={{ fontSize: '12.5px', color: 'var(--red)', lineHeight: 1.7 }}>
            {errors.map((e, i) => <div key={i}>✕ {e}</div>)}
          </div>
        )}
        {warnings.length > 0 && (
          <div style={{ fontSize: '12.5px', color: 'var(--amber)', lineHeight: 1.7 }}>
            {warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
          </div>
        )}
        {blocked.length > 0 && (
          <div style={{ fontSize: '12.5px', color: 'var(--amber)', lineHeight: 1.7 }}>
            This cannot be backtested as configured:
            {blocked.map((b) => <div key={b.id}>· <strong>{b.label}</strong> — {b.why}</div>)}
            <div style={{ color: 'var(--muted)' }}>
              You can still generate the Python and run it live, but Rāma has not judged it.
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn btn-primary" onClick={runBacktest}
                  disabled={busy || !canRequest || errors.length > 0 || blocked.length > 0
                    || picked.length === 0}
                  title={!canRequest ? 'Backtesting needs Operator tier or higher'
                    : blocked.length > 0 ? 'Remove the blocks that cannot be backtested'
                      : errors.length > 0 ? 'Fix the errors above' : ''}>
            {busy ? 'Searching…' : `⚗ Backtest ${trials.toLocaleString()} variant${trials === 1 ? '' : 's'}`}
          </button>
          <button className="btn" onClick={generateCode}
                  disabled={codeBusy || errors.length > 0 || picked.length === 0}
                  title="Emit a standalone Python file. It prints signals; it never places orders.">
            {codeBusy ? 'Generating…' : '🐍 Generate Python'}
          </button>
          {!canRequest && (
            <span style={{ fontSize: '12.5px', color: 'var(--amber)' }}>
              Backtesting needs Operator tier or higher.
            </span>
          )}
        </div>
      </div>

      {/* ── The verdict. First, and before any return figure. ─────────────── */}
      {result && result.ok === false && (
        <div className="hud-card" style={{ padding: '14px', borderColor: 'var(--amber)' }}>
          <div className="section-label" style={{ marginBottom: '6px' }}>NOT RUN</div>
          <div style={{ fontSize: '12.5px', color: 'var(--amber)', lineHeight: 1.7 }}>
            {result.reason}
          </div>
        </div>
      )}

      {verdict && (
        <div className="hud-card" style={{ padding: '14px',
          borderColor: verdict.passed ? 'var(--green)' : 'var(--red)' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap',
            marginBottom: '8px' }}>
            <div className="section-label">VERDICT</div>
            <span className={`badge ${verdict.passed ? 'badge-green' : 'badge-red'}`}>
              {verdict.passed ? 'EDGE DEMONSTRATED' : 'NOT DEMONSTRATED'}
            </span>
            <span className="badge">{String(verdict.confidence || '').toUpperCase()}</span>
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: '12px', color: 'var(--muted)' }}>
              {result.trials} variant{result.trials === 1 ? '' : 's'} searched ·{' '}
              {verdict.trades} holdout trades
            </span>
          </div>

          <div style={{ fontSize: '13px', color: 'var(--text)', lineHeight: 1.7,
            maxWidth: '76ch' }}>
            {verdict.meaning}
          </div>

          {(verdict.risks || []).length > 0 && (
            <ul style={{ margin: '8px 0 0', paddingLeft: '18px', fontSize: '12.5px',
              color: 'var(--amber)', lineHeight: 1.7 }}>
              {verdict.risks.map((r, i) => <li key={i}>{r}</li>)}
            </ul>
          )}
          {(verdict.would_change || []).length > 0 && (
            <>
              <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '8px' }}>
                WHAT WOULD CHANGE THIS
              </div>
              <ul style={{ margin: '2px 0 0', paddingLeft: '18px', fontSize: '12.5px',
                color: 'var(--text-dim)', lineHeight: 1.7 }}>
                {verdict.would_change.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            </>
          )}

          {/* The numbers stay available underneath. They are not the headline — a table of statistics
              is not a judgement, which is what `meaning` is for (Section 95). */}
          <details style={{ marginTop: '10px' }}>
            <summary style={{ cursor: 'pointer', fontSize: '12px', color: 'var(--muted)' }}>
              the numbers
            </summary>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))',
              gap: '10px', marginTop: '8px', fontSize: '12.5px' }}>
              <Field label="NET SHARPE"><span>{dec(verdict.net_sharpe)}</span></Field>
              <Field label="NOISE BENCHMARK" hint={`from ${result.trials} tries`}>
                <span>{dec(verdict.benchmark_sharpe)}</span>
              </Field>
              <Field label="CHANCE IT IS REAL">
                <span>{verdict.deflated == null ? '—' : `${(verdict.deflated * 100).toFixed(0)}%`}</span>
              </Field>
              <Field label="WIN RATE">
                <span>{verdict.win_rate == null ? '—' : `${(verdict.win_rate * 100).toFixed(1)}%`}</span>
              </Field>
              <Field label="EXPECTANCY" hint="net, per trade">
                <span style={{ color: pnlColor(verdict.expectancy_pct) }}>
                  {dec(verdict.expectancy_pct)}%
                </span>
              </Field>
              <Field label="MAX DRAWDOWN">
                <span>{verdict.max_drawdown == null ? '—'
                  : `${(verdict.max_drawdown * 100).toFixed(1)}%`}</span>
              </Field>
              <Field label="COST DRAG" hint="round trip">
                <span>{dec(verdict.cost_drag_pct)}%</span>
              </Field>
              <Field label="GROSS SHARPE" hint="before costs">
                <span>{dec(verdict.gross_sharpe)}</span>
              </Field>
            </div>
            <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '8px',
              lineHeight: 1.6 }}>
              {result.note}
            </div>
          </details>
        </div>
      )}

      {/* ── Money, on the holdout only ─────────────────────────────────────── */}
      {result?.money?.ok && (
        <div className="hud-card" style={{ padding: '14px' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap',
            marginBottom: '8px' }}>
            <div className="section-label">ON THE HOLDOUT, IN MONEY</div>
            <span style={{ fontSize: '12px', color: 'var(--muted)' }}>
              {result.window?.holdoutBars} bars the search never saw
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))',
            gap: '10px' }}>
            <Field label="CAPITAL"><span>{money(result.money.capital)}</span></Field>
            <Field label="NET P&L">
              <span style={{ color: pnlColor(result.money.netPnl), fontWeight: 700 }}>
                {signed(result.money.netPnl)}
              </span>
            </Field>
            <Field label="ROI" hint="reported, not requested">
              <span style={{ color: pnlColor(result.money.roiPct), fontWeight: 700 }}>
                {dec(result.money.roiPct, 1)}%
              </span>
            </Field>
            <Field label="WORST DRAWDOWN">
              <span>{dec(result.money.maxDrawdownPct, 1)}%</span>
            </Field>
            <Field label="TRADES SIZED">
              <span>{result.money.sizedTrades}
                {result.money.unsizedTrades > 0 && (
                  <span style={{ color: 'var(--amber)' }}> ({result.money.unsizedTrades} unsized)</span>
                )}
              </span>
            </Field>
          </div>
          <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '8px', lineHeight: 1.6 }}>
            {result.money.note}
          </div>
        </div>
      )}

      {/* ── The Python ─────────────────────────────────────────────────────── */}
      {code && (
        <div className="hud-card" style={{ padding: '14px' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap',
            marginBottom: '8px' }}>
            <div className="section-label">PYTHON</div>
            {code.ok ? (
              <>
                <span style={{ fontSize: '12px', color: 'var(--muted)' }}>
                  {code.filename} · {code.lines} lines · spec {code.specHash}
                </span>
                <span style={{ flex: 1 }} />
                <button type="button" className="btn btn-sm" onClick={copyCode}>copy</button>
              </>
            ) : (
              <span style={{ fontSize: '12.5px', color: 'var(--red)' }}>{code.reason}</span>
            )}
          </div>
          {code.ok && (
            <>
              <div style={{ fontSize: '12px', color: 'var(--muted)', lineHeight: 1.7,
                marginBottom: '8px' }}>
                The block logic in this file is copied from the engine functions that ran the backtest,
                so the file and the verdict cannot disagree. It prints signals and sizes;{' '}
                <strong>it does not place orders</strong>, and Rāma will not be given that ability.
                Run it as <code>python {code.filename} bars.csv</code>.
              </div>
              <pre style={{
                margin: 0, padding: '10px 12px', maxHeight: '420px', overflow: 'auto',
                background: 'rgba(0,0,0,0.35)', border: '1px solid var(--border)',
                borderRadius: 'var(--radius)', fontSize: '11.5px', color: 'var(--text-dim)',
                lineHeight: 1.5,
              }}>{code.code}</pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}
