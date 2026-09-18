import React, { useCallback, useEffect, useMemo, useState } from 'react';
import SymbolSearch from './SymbolSearch.jsx';
import { closePreview, closeAgainstThesis } from './positionMath.js';

/**
 * BookPanel — what master actually holds, and what Rāma wants to tell him about it.
 *
 * This closes the gap Sections 74, 75 and 77 all ended on: the ledger and the alerts existed and
 * nothing in the UI called them. Positions were enterable by API only.
 *
 * TRADE STYLE IS A FIRST-CLASS COLUMN (Section 77), not a detail in a drawer, because an intraday
 * position that was never squared off is the most expensive thing in this panel and master has to
 * be able to see it at a glance.
 *
 * ALERTS ARE SPLIT BY WHETHER THEY MAY BE ACTED ON (Section 75). Actionable ones are shown; the
 * withheld ones are collapsed behind a count with their reasons, so master can see that Rāma
 * looked without an unvalidated model reading sitting next to a real stop breach as if they were
 * the same kind of statement.
 */

const STYLES = ['INTRADAY', 'SWING', 'POSITIONAL', 'LONGTERM'];
const INSTR = ['EQUITY', 'FUTURES', 'OPTIONS'];

const STYLE_COLOR = {
  INTRADAY: 'var(--amber)', SWING: 'var(--accent)',
  POSITIONAL: 'var(--green)', LONGTERM: 'var(--muted)',
};
const SEV_COLOR = { critical: 'var(--red)', warning: 'var(--amber)', info: 'var(--muted)' };

const money = (v) => (typeof v === 'number' && Number.isFinite(v)
  ? v.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—');

const signed = (v) => (typeof v === 'number' && Number.isFinite(v)
  ? `${v >= 0 ? '+' : ''}${money(v)}` : '—');

const pnlColor = (v) => (typeof v !== 'number' || !Number.isFinite(v)
  ? 'var(--muted)' : v > 0 ? 'var(--green)' : v < 0 ? 'var(--red)' : 'var(--text)');

function Field({ label, children }) {
  return (
    <div>
      <div style={{ fontSize: '12.5px', color: 'var(--muted)', marginBottom: '3px' }}>{label}</div>
      {children}
    </div>
  );
}

export default function BookPanel({ currentUser, canConfig, symbol, exchange,
  lastClose, onPickSymbol }) {
  const [positions, setPositions] = useState([]);
  const [portfolio, setPortfolio] = useState(null);
  const [alerts, setAlerts] = useState(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showWithheld, setShowWithheld] = useState(false);
  const [expanded, setExpanded] = useState(null);
  // Closing a position (Section 102). `closing` holds the position, never just its id, so the
  // preview can be computed without another lookup that could go stale mid-edit.
  const [closing, setClosing] = useState(null);
  const [closeForm, setCloseForm] = useState({ price: '', quantity: '', date: '', fees: '' });
  const [closeBusy, setCloseBusy] = useState(false);

  const [form, setForm] = useState({
    symbol: symbol || '', instrType: 'EQUITY', tradeStyle: 'POSITIONAL', side: 'BUY',
    quantity: '', price: '', date: '', fees: '', stopPrice: '', targetPrice: '',
    horizon: '', rationale: '',
  });

  useEffect(() => { setForm((f) => ({ ...f, symbol: f.symbol || symbol || '' })); }, [symbol]);

  const hasBridge = typeof window !== 'undefined' && !!window.rama?.marketIntel;

  const load = useCallback(async () => {
    if (!hasBridge) return;
    setBusy(true);
    const [p, b, a] = await Promise.all([
      window.rama.marketIntel.ledgerPositions({ user: currentUser }),
      window.rama.marketIntel.ledgerPortfolio({ user: currentUser }),
      window.rama.marketIntel.alerts({ user: currentUser }),
    ]);
    setBusy(false);
    setPositions(p?.ok === false ? [] : (p?.data?.positions || []));
    setPortfolio(b?.ok === false ? { error: b.error } : b?.data || null);
    setAlerts(a?.ok === false ? { error: a.error } : a?.data || null);
    if (p?.ok === false) setNote(p.error);
  }, [currentUser]);

  useEffect(() => { load(); }, [load]);

  const submit = async (e) => {
    e.preventDefault();
    if (!hasBridge) return;
    setNote(null);
    const thesis = {};
    for (const k of ['stopPrice', 'targetPrice']) {
      if (form[k] !== '' && Number.isFinite(Number(form[k]))) thesis[k] = Number(form[k]);
    }
    if (form.horizon) thesis.horizon = form.horizon;
    if (form.rationale) thesis.rationale = form.rationale;

    const res = await window.rama.marketIntel.ledgerOpen({
      user: currentUser,
      symbol: (form.symbol || '').trim().toUpperCase(),
      exchange: exchange || 'NSE',
      instrType: form.instrType,
      tradeStyle: form.tradeStyle,
      side: form.side,
      quantity: Number(form.quantity),
      price: Number(form.price),
      date: form.date || null,
      fees: form.fees === '' ? 0 : Number(form.fees),
      thesis: Object.keys(thesis).length ? thesis : null,
    });
    if (res?.ok === false) { setNote(res.error || 'Could not record the position'); return; }
    setShowAdd(false);
    setForm((f) => ({ ...f, quantity: '', price: '', fees: '', rationale: '' }));
    load();
  };

  /**
   * WHAT THIS REPLACED, AND WHY IT MATTERED (spec Section 102).
   *
   * Closing a position used `window.prompt`. On a real-money action that is the worst control in the
   * module: it accepts any string, shows no consequence, offers no quantity so a partial exit was
   * impossible, no date, no fees, and no confirmation of what is about to be realised. Typing 24.50
   * where 2450 was meant produced a recorded loss with no warning of any kind.
   *
   * It is now a form with a live preview: what this exit realises net of fees, how it sits against
   * master's own recorded stop and target, and what remains open. The maths is in `positionMath.js`
   * and is tested, because a wrong number beside a commit button converts caution into false
   * confidence.
   */
  const beginClose = (pos) => {
    setNote(null);
    setClosing(pos);
    setCloseForm({
      // Prefilled with the last known price so the common case is one click — but editable, because
      // the last stored close is not necessarily where master actually got out.
      price: pos.lastPrice != null ? String(pos.lastPrice) : '',
      quantity: String(Math.abs(Number(pos.netQty) || 0)),
      date: '', fees: '',
    });
  };

  const preview = useMemo(
    () => (closing ? closePreview(closing, closeForm.price, closeForm.quantity, closeForm.fees) : null),
    [closing, closeForm.price, closeForm.quantity, closeForm.fees],
  );
  const thesisNotes = useMemo(
    () => (closing ? closeAgainstThesis(closing, closeForm.price) : []),
    [closing, closeForm.price],
  );

  /**
   * A PARTIAL EXIT IS AN OPPOSING FILL, NOT A CLOSE, and the two use different routes.
   *
   * `/ledger/close` takes no quantity — it exits the whole open position by design. Sending it a
   * quantity would have been ignored silently while the preview here promised "60 remaining", so the
   * form would have claimed a partial exit and the ledger would have recorded a full one. Reducing a
   * position is what `/ledger/fill` is for, and routing by `preview.partial` keeps the preview and
   * the record describing the same event.
   */
  const confirmClose = async (e) => {
    e.preventDefault();
    if (!hasBridge || !closing || !preview?.ok) return;
    setCloseBusy(true);
    const fees = Number(closeForm.fees) || 0;
    const common = {
      user: currentUser, positionId: closing.positionId,
      price: preview.price, date: closeForm.date || null, fees,
    };
    const res = preview.partial
      ? await window.rama.marketIntel.ledgerFill({
        ...common,
        side: preview.isShort ? 'BUY' : 'SELL',
        quantity: preview.quantity,
        note: 'partial exit',
      })
      : await window.rama.marketIntel.ledgerClose({ ...common, note: 'closing fill' });
    setCloseBusy(false);
    if (res?.ok === false) { setNote(res.error || 'Could not record the exit'); return; }
    setClosing(null);
    load();
  };

  const restyle = async (pos, style) => {
    if (!hasBridge) return;
    const res = await window.rama.marketIntel.ledgerSetStyle({
      user: currentUser, positionId: pos.positionId, tradeStyle: style,
    });
    if (res?.ok === false) { setNote(res.error); return; }
    load();
  };

  const open = useMemo(() => positions.filter((p) => p.status === 'open'), [positions]);
  const closed = useMemo(() => positions.filter((p) => p.status !== 'open'), [positions]);
  const actionable = useMemo(
    () => (alerts?.alerts || []).filter((a) => a.actionable), [alerts]);
  const withheld = useMemo(
    () => (alerts?.alerts || []).filter((a) => !a.actionable), [alerts]);

  if (!hasBridge) {
    return <div style={{ color: 'var(--muted)', fontSize: '12px' }}>
      Ledger unavailable — run inside the Rāma desktop app.
    </div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>

      {/* ── Alerts that may be acted on ─────────────────────────────────────── */}
      {actionable.length > 0 && (
        <div className="hud-card" style={{ padding: '12px 14px' }}>
          <div className="section-label" style={{ marginBottom: '8px' }}>
            NEEDS YOUR ATTENTION ({actionable.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {actionable.map((a, i) => (
              <div key={`${a.kind}${i}`} style={{
                borderLeft: `3px solid ${SEV_COLOR[a.severity] || 'var(--border)'}`,
                paddingLeft: '10px',
              }}>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'baseline',
                  flexWrap: 'wrap' }}>
                  <span style={{
                    fontSize: '12.5px', fontWeight: 700, letterSpacing: '0.06em',
                    color: SEV_COLOR[a.severity] || 'var(--muted)',
                  }}>{a.action}</span>
                  <span style={{ fontSize: '12.5px', color: 'var(--text)', fontWeight: 600 }}>
                    {a.headline}
                  </span>
                  <span style={{ fontSize: '12.5px', color: 'var(--muted)' }}>{a.evidence}</span>
                </div>
                <div style={{ fontSize: '12.5px', color: 'var(--text-dim)', lineHeight: 1.6,
                  marginTop: '2px' }}>
                  {a.detail}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Withheld alerts are collapsed, never mixed in with the actionable ones. */}
      {withheld.length > 0 && (
        <div style={{ fontSize: '12px', color: 'var(--muted)' }}>
          <button type="button" onClick={() => setShowWithheld((s) => !s)}
                  style={{ background: 'none', border: 'none', color: 'var(--muted)',
                    cursor: 'pointer', padding: 0, textDecoration: 'underline' }}>
            {showWithheld ? 'hide' : 'show'} {withheld.length} reading
            {withheld.length === 1 ? '' : 's'} Rāma will not act on
          </button>
          {showWithheld && (
            <div style={{ marginTop: '6px', display: 'flex', flexDirection: 'column',
              gap: '6px', paddingLeft: '10px', borderLeft: '1px dashed var(--border)' }}>
              {withheld.map((a, i) => (
                <div key={`w${i}`}>
                  <div style={{ color: 'var(--text-dim)' }}>{a.headline}</div>
                  <div style={{ color: 'var(--muted)', lineHeight: 1.5 }}>
                    {a.whyNotActionable}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Portfolio, broken out by style ──────────────────────────────────── */}
      <div className="hud-card" style={{ padding: '12px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
          <div className="section-label">YOUR BOOK</div>
          <div style={{ flex: 1 }} />
          <button type="button" className="btn btn-sm" onClick={load} disabled={busy}>
            {busy ? '…' : 'refresh'}
          </button>
          {canConfig && (
            <button type="button" className="btn btn-sm btn-primary"
                    onClick={() => setShowAdd((s) => !s)}>
              {showAdd ? 'cancel' : '+ record a trade'}
            </button>
          )}
        </div>

        {portfolio && !portfolio.error && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(110px,1fr))',
              gap: '10px', marginBottom: '10px' }}>
              <Field label="INVESTED"><span style={{ fontSize: '13px' }}>
                {money(portfolio.investedValue)}</span></Field>
              <Field label="MARKET VALUE"><span style={{ fontSize: '13px' }}>
                {money(portfolio.marketValue)}</span></Field>
              <Field label="UNREALISED"><span style={{ fontSize: '13px',
                color: pnlColor(portfolio.unrealisedPnl) }}>
                {signed(portfolio.unrealisedPnl)}</span></Field>
              <Field label="REALISED"><span style={{ fontSize: '13px',
                color: pnlColor(portfolio.realisedPnl) }}>
                {signed(portfolio.realisedPnl)}</span></Field>
              <Field label="NET OF FEES"><span style={{ fontSize: '13px',
                color: pnlColor(portfolio.netPnl) }}>
                {signed(portfolio.netPnl)}</span></Field>
            </div>

            {portfolio.byStyle && Object.keys(portfolio.byStyle).length > 0 && (
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', fontSize: '12px' }}>
                {Object.entries(portfolio.byStyle).map(([s, v]) => (
                  <span key={s} style={{
                    padding: '2px 8px', borderRadius: '999px',
                    border: `1px solid ${STYLE_COLOR[s] || 'var(--border)'}`,
                    color: STYLE_COLOR[s] || 'var(--muted)',
                  }}>
                    {s} {v.open} · {money(v.investedValue)}
                    {v.unrealisedPnl !== null && v.unrealisedPnl !== undefined && (
                      <span style={{ color: pnlColor(v.unrealisedPnl) }}>
                        {' '}{signed(v.unrealisedPnl)}
                      </span>
                    )}
                  </span>
                ))}
              </div>
            )}

            {/* Never let master read a total as complete when it is not. */}
            {(portfolio.unpricedSymbols || []).length > 0 && (
              <div style={{ fontSize: '12px', color: 'var(--amber)', marginTop: '8px' }}>
                {portfolio.priceCoverage}. Not priced: {portfolio.unpricedSymbols.join(', ')} —
                sync those symbols before trusting the totals.
              </div>
            )}
            {portfolio.inferredStyleCount > 0 && (
              <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '4px' }}>
                {portfolio.inferredStyleCount} position
                {portfolio.inferredStyleCount === 1 ? '' : 's'} recorded before trade styles
                existed, shown as POSITIONAL. Set the real style to get the right alerts.
              </div>
            )}
          </>
        )}
        {portfolio?.error && (
          <div style={{ fontSize: '12.5px', color: 'var(--red)' }}>{portfolio.error}</div>
        )}
        {note && <div style={{ fontSize: '12.5px', color: 'var(--red)', marginTop: '8px' }}>{note}</div>}
      </div>

      {/* ── Record a trade ──────────────────────────────────────────────────── */}
      {showAdd && canConfig && (
        <form className="hud-card" onSubmit={submit}
              style={{ padding: '14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div className="section-label">RECORD A TRADE YOU TOOK</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(96px,1fr))',
            gap: '10px' }}>
            {/* Searchable here too (Section 102). This form had the same raw text box, and it is the
                worse place for it: a mistyped symbol on a recorded trade puts a position in the book
                that can never be priced, and the portfolio totals then silently exclude it. */}
            <Field label="INSTRUMENT">
              <SymbolSearch
                id="book-symbol"
                value={form.symbol}
                exchange={exchange || 'NSE'}
                onPick={({ symbol: s }) => setForm((f) => ({ ...f, symbol: s }))}
                ariaLabel="Search for the instrument you traded"
                placeholder="search, or type the exact ticker"
              />
            </Field>
            <Field label="STYLE">
              <select className="input" value={form.tradeStyle}
                      onChange={(e) => setForm({ ...form, tradeStyle: e.target.value })}>
                {STYLES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="INSTRUMENT">
              <select className="input" value={form.instrType}
                      onChange={(e) => setForm({ ...form, instrType: e.target.value })}>
                {INSTR.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="SIDE">
              <select className="input" value={form.side}
                      onChange={(e) => setForm({ ...form, side: e.target.value })}>
                <option value="BUY">BUY</option><option value="SELL">SELL</option>
              </select>
            </Field>
            <Field label="QUANTITY">
              <input className="input" type="number" step="any" min="0" required
                     value={form.quantity}
                     onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
            </Field>
            <Field label="PRICE">
              <input className="input" type="number" step="any" min="0" required
                     value={form.price} placeholder={lastClose ? String(lastClose) : ''}
                     onChange={(e) => setForm({ ...form, price: e.target.value })} />
            </Field>
            <Field label="DATE">
              <input className="input" type="date" value={form.date}
                     onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </Field>
            <Field label="FEES">
              <input className="input" type="number" step="any" min="0" value={form.fees}
                     onChange={(e) => setForm({ ...form, fees: e.target.value })} />
            </Field>
          </div>

          <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '2px' }}>
            The projection you acted on. Without it, "was I right or lucky?" has no answer later,
            and Rāma cannot warn you about a stop you never gave it.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(96px,1fr))',
            gap: '10px' }}>
            <Field label="STOP">
              <input className="input" type="number" step="any" value={form.stopPrice}
                     onChange={(e) => setForm({ ...form, stopPrice: e.target.value })} />
            </Field>
            <Field label="TARGET">
              <input className="input" type="number" step="any" value={form.targetPrice}
                     onChange={(e) => setForm({ ...form, targetPrice: e.target.value })} />
            </Field>
            <Field label="THESIS HORIZON">
              <select className="input" value={form.horizon}
                      onChange={(e) => setForm({ ...form, horizon: e.target.value })}>
                <option value="">—</option>
                <option value="intraday">intraday</option>
                <option value="swing">swing</option>
                <option value="positional">positional</option>
              </select>
            </Field>
          </div>
          <Field label="WHY YOU TOOK IT">
            <input className="input" value={form.rationale}
                   onChange={(e) => setForm({ ...form, rationale: e.target.value })}
                   placeholder="the reason, in your own words" />
          </Field>
          <div><button type="submit" className="btn btn-primary btn-sm">record</button></div>
        </form>
      )}

      {/* ── Closing a position: a form with a preview, not a native prompt (Section 102) ────── */}
      {closing && canConfig && (
        <form className="hud-card" onSubmit={confirmClose}
              style={{ padding: '14px', display: 'flex', flexDirection: 'column', gap: '10px',
                borderColor: 'var(--amber)' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap' }}>
            <div className="section-label">
              EXIT {closing.symbol} — {preview?.direction || ''} {Math.abs(closing.netQty)} @ {money(closing.avgCost)}
            </div>
            <span style={{ fontSize: '12px', color: STYLE_COLOR[closing.tradeStyle] }}>
              {closing.tradeStyle}
            </span>
            <span style={{ flex: 1 }} />
            <button type="button" className="btn btn-sm" onClick={() => setClosing(null)}>cancel</button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(96px,1fr))',
            gap: '10px' }}>
            <Field label="EXIT PRICE">
              <input className="input" type="number" step="any" min="0" required autoFocus
                     value={closeForm.price}
                     onChange={(e) => setCloseForm({ ...closeForm, price: e.target.value })} />
            </Field>
            <Field label="QUANTITY">
              <input className="input" type="number" step="any" min="0"
                     max={Math.abs(Number(closing.netQty) || 0)}
                     value={closeForm.quantity}
                     onChange={(e) => setCloseForm({ ...closeForm, quantity: e.target.value })} />
            </Field>
            <Field label="DATE">
              <input className="input" type="date" value={closeForm.date}
                     onChange={(e) => setCloseForm({ ...closeForm, date: e.target.value })} />
            </Field>
            <Field label="FEES">
              <input className="input" type="number" step="any" min="0" value={closeForm.fees}
                     onChange={(e) => setCloseForm({ ...closeForm, fees: e.target.value })} />
            </Field>
          </div>

          {/* The consequence, before the commit. This is the whole reason the prompt had to go. */}
          <div aria-live="polite" style={{
            padding: '9px 11px', borderRadius: 'var(--radius)', lineHeight: 1.7,
            background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)',
            fontSize: '12.5px',
          }}>
            {preview?.ok ? (
              <>
                <div>
                  <span style={{ color: 'var(--muted)' }}>This realises </span>
                  <strong style={{ color: pnlColor(preview.net), fontSize: '13.5px' }}>
                    {signed(preview.net)}
                  </strong>
                  {preview.pctOnCost !== null && (
                    <span style={{ color: pnlColor(preview.pctOnCost) }}>
                      {' '}({preview.pctOnCost >= 0 ? '+' : ''}{preview.pctOnCost.toFixed(2)}%)
                    </span>
                  )}
                  <span style={{ color: 'var(--muted)' }}>
                    {' '}on {preview.quantity} at {money(preview.price)}
                    {Number(closeForm.fees) > 0 && ` · gross ${signed(preview.gross)} less fees`}
                  </span>
                </div>
                <div style={{ color: 'var(--muted)' }}>
                  {preview.partial
                    ? `Partial exit — ${preview.remaining} stays open and is recorded as a `
                      + 'reducing fill, not a close.'
                    : 'Closes the position in full.'}
                </div>
                {thesisNotes.map((n, i) => (
                  <div key={i} style={{
                    color: n.tone === 'good' ? 'var(--green)'
                      : n.tone === 'warn' ? 'var(--amber)' : 'var(--muted)',
                  }}>
                    {n.text}
                  </div>
                ))}
              </>
            ) : (
              <span style={{ color: 'var(--muted)' }}>{preview?.reason || 'Enter an exit price.'}</span>
            )}
          </div>

          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button type="submit" className="btn btn-primary btn-sm"
                    disabled={!preview?.ok || closeBusy}
                    title={preview?.ok ? '' : (preview?.reason || 'Enter an exit price')}>
              {closeBusy ? 'recording…'
                : preview?.partial ? `record exit of ${preview.quantity}` : 'close the position'}
            </button>
            {!preview?.ok && (
              <span style={{ fontSize: '12px', color: 'var(--amber)' }}>{preview?.reason}</span>
            )}
          </div>
        </form>
      )}

      {/* ── Open positions ──────────────────────────────────────────────────── */}
      <div className="hud-card" style={{ padding: '12px 14px' }}>
        <div className="section-label" style={{ marginBottom: '8px' }}>
          OPEN POSITIONS ({open.length})
        </div>
        {open.length === 0 ? (
          <div style={{ fontSize: '12.5px', color: 'var(--muted)' }}>
            Nothing tracked yet. Record what you hold and Rāma can watch your stops, your
            holding periods and your concentration for you.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px' }}>
              <thead>
                <tr style={{ color: 'var(--muted)', textAlign: 'left' }}>
                  {/* Every abbreviation carries its meaning (Section 102). Nine short column heads
                      with no explanation is a table only its author can read. */}
                  <th style={{ padding: '4px 6px' }}>SYMBOL</th>
                  <th style={{ padding: '4px 6px' }}
                      title="How you intended to hold it. Drives which warnings Rāma raises — an
intraday position still open overnight is the expensive one.">STYLE</th>
                  <th style={{ padding: '4px 6px', textAlign: 'right' }}
                      title="Net open quantity. Negative means short.">QTY</th>
                  <th style={{ padding: '4px 6px', textAlign: 'right' }}
                      title="Average cost across every fill, including fees you recorded.">AVG</th>
                  <th style={{ padding: '4px 6px', textAlign: 'right' }}
                      title="Last stored close for this symbol. Amber when the stored price is behind.">LAST</th>
                  <th style={{ padding: '4px 6px', textAlign: 'right' }}
                      title="Unrealised profit or loss at the last stored price.">P&amp;L</th>
                  <th style={{ padding: '4px 6px', textAlign: 'right' }}
                      title="The same, as a percentage of what you put in.">%</th>
                  <th style={{ padding: '4px 6px', textAlign: 'right' }}
                      title="Calendar days since your first fill.">DAYS</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {open.map((p) => (
                  <React.Fragment key={p.positionId}>
                    <tr style={{ borderTop: '1px solid var(--border)', cursor: 'pointer' }}
                        onClick={() => setExpanded(expanded === p.positionId ? null : p.positionId)}>
                      <td style={{ padding: '5px 6px', fontWeight: 600 }}>
                        {/* A BUTTON, NOT A SPAN (Section 102). This was a `<span>` with an onClick:
                            not focusable, not reachable by keyboard, and not announced as an action —
                            so the only route from the book to the chart was mouse-only. */}
                        <button type="button"
                                onClick={(e) => { e.stopPropagation(); onPickSymbol?.(p.symbol); }}
                                style={{
                                  background: 'none', border: 'none', padding: 0, font: 'inherit',
                                  color: 'var(--accent)', cursor: 'pointer',
                                  textDecoration: 'underline dotted',
                                }}
                                title={`Show ${p.symbol} on the chart`}>{p.symbol}</button>
                        <span style={{ color: 'var(--muted)', fontWeight: 400 }}>
                          {' '}{p.instrType !== 'EQUITY' ? p.instrType : ''}
                        </span>
                      </td>
                      <td style={{ padding: '5px 6px' }}>
                        <span style={{ color: STYLE_COLOR[p.tradeStyle] || 'var(--muted)' }}
                              title={p.styleInferred
                                ? 'Assumed, not chosen — this position predates trade styles. Open '
                                  + 'the row and set the real one to get the right warnings.'
                                : 'You set this style.'}>
                          {p.tradeStyle}{p.styleInferred ? ' (assumed)' : ''}
                        </span>
                      </td>
                      <td style={{ padding: '5px 6px', textAlign: 'right' }}>{p.netQty}</td>
                      <td style={{ padding: '5px 6px', textAlign: 'right' }}>{money(p.avgCost)}</td>
                      <td style={{ padding: '5px 6px', textAlign: 'right',
                        color: p.priceStale ? 'var(--amber)' : 'var(--text)' }}
                          title={p.priceStale ? 'price is stale' : ''}>
                        {p.lastPrice === null ? '—' : money(p.lastPrice)}
                      </td>
                      <td style={{ padding: '5px 6px', textAlign: 'right',
                        color: pnlColor(p.unrealisedPnl) }}>{signed(p.unrealisedPnl)}</td>
                      <td style={{ padding: '5px 6px', textAlign: 'right',
                        color: pnlColor(p.pnlPct) }}>
                        {p.pnlPct === null ? '—' : `${p.pnlPct}%`}
                      </td>
                      <td style={{ padding: '5px 6px', textAlign: 'right',
                        color: 'var(--muted)' }}>{p.daysHeld ?? '—'}</td>
                      <td style={{ padding: '5px 6px', textAlign: 'right' }}>
                        {canConfig && (
                          <button type="button" className="btn btn-sm"
                                  aria-expanded={closing?.positionId === p.positionId}
                                  onClick={(e) => { e.stopPropagation(); beginClose(p); }}
                                  title="Open the exit form — it shows what the exit realises before
anything is recorded.">
                            exit…
                          </button>
                        )}
                      </td>
                    </tr>
                    {expanded === p.positionId && (
                      <tr>
                        <td colSpan={9} style={{
                          padding: '8px 10px', background: 'var(--surface)',
                          fontSize: '12px', color: 'var(--text-dim)', lineHeight: 1.7,
                        }}>
                          {p.thesis?.rationale && <div>“{p.thesis.rationale}”</div>}
                          <div>
                            {p.thesis?.stopPrice ? `stop ${money(p.thesis.stopPrice)} · ` : 'no stop recorded · '}
                            {p.thesis?.targetPrice ? `target ${money(p.thesis.targetPrice)} · ` : ''}
                            {p.fillCount} fill{p.fillCount === 1 ? '' : 's'} ·
                            {' '}first {p.firstFillDate} · invested {money(p.investedValue)}
                            {p.feesTotal ? ` · fees ${money(p.feesTotal)}` : ''}
                          </div>
                          {p.styleVsThesis && (
                            <div style={{ color: 'var(--amber)' }}>{p.styleVsThesis}</div>
                          )}
                          {(p.flags || []).map((f, i) => (
                            <div key={i} style={{ color: 'var(--amber)' }}>{f}</div>
                          ))}
                          {canConfig && (
                            <div style={{ display: 'flex', gap: '6px', marginTop: '6px',
                              alignItems: 'center' }}>
                              <span style={{ color: 'var(--muted)' }}>set style:</span>
                              {STYLES.filter((s) => s !== p.tradeStyle).map((s) => (
                                <button key={s} type="button" className="btn btn-sm"
                                        onClick={() => restyle(p, s)}>{s}</button>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {closed.length > 0 && (
        <div className="hud-card" style={{ padding: '12px 14px' }}>
          <div className="section-label" style={{ marginBottom: '8px' }}>
            CLOSED ({closed.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12.5px' }}>
            {closed.slice(0, 12).map((p) => (
              <div key={p.positionId} style={{ display: 'flex', gap: '10px' }}>
                <span style={{ fontWeight: 600, minWidth: '80px' }}>{p.symbol}</span>
                <span style={{ color: STYLE_COLOR[p.tradeStyle], minWidth: '78px' }}>
                  {p.tradeStyle}
                </span>
                <span style={{ color: pnlColor(p.realisedPnl) }}>{signed(p.realisedPnl)}</span>
                <span style={{ color: 'var(--muted)' }}>
                  {p.daysHeld ?? '—'}d · {p.fillCount} fills
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}


