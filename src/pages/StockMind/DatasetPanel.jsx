import React, { useCallback, useEffect, useState } from 'react';
import InfoTip from './InfoTip.jsx';
import { FS, LH } from '@config/type.js';
import {
  saveFormView, saveSummary, unwrap, refusalSentence, savedSentence, datasetRows,
  bannerText, BANNER_BACK, BANNER_SENTENCE,
} from './datasetModel.js';

/**
 * DatasetPanel - save what the chart shows under a name, and look at saved copies (spec Section 153).
 *
 * Master: *"for normal display why the fetch and store, just change the display when any parameter is
 * modified - and if user wants to specifically save for future ref then store it in DB and fetch with
 * name convention."*
 *
 * WHAT THIS SCREEN WILL NOT DO
 *   - Save on its own. Saving, loading and deleting are three separate clicks, and deleting asks first.
 *   - Send candles to the engine. It sends the parameters; the engine rebuilds the snapshot from the same
 *     data the chart shows, so the window is not trusted to say what the data was.
 *   - Feed a saved dataset to strategy or training. Loading one only draws it, read-only.
 *   - Run on a timer. The list is read when it is opened and after master saves or deletes.
 */
const inBridge = typeof window !== 'undefined' && !!window.rama?.marketIntel;

/** The strip above the chart while a saved copy is on screen, with the way back to live. */
export function SnapshotBanner({ meta, onBack }) {
  if (!meta) return null;
  return (
    <div role="status" style={{
      display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', padding: '6px 10px',
      marginBottom: '8px', border: '1px solid var(--gold)', borderRadius: 'var(--radius)',
    }}>
      <span className="badge badge-amber" style={{ fontSize: FS.denseLg }}>{bannerText(meta)}</span>
      <span style={{ fontSize: FS.dense, color: 'var(--muted)', lineHeight: LH.chrome }}>
        {BANNER_SENTENCE}
      </span>
      <div style={{ flex: 1 }} />
      <button type="button" className="btn btn-sm" onClick={onBack}>{BANNER_BACK}</button>
    </div>
  );
}

export default function DatasetPanel({
  currentUser, canView, canRequest, mode, onMode, symbol, exchange, interval, fromDate, toDate,
  limit, bars, unsaved, viewingName, onView, onBack,
}) {
  const user = currentUser;
  const [label, setLabel] = useState('snapshot');
  const [name, setName] = useState('');
  const [nameEdited, setNameEdited] = useState(false);
  const [note, setNote] = useState('');
  const [overwrite, setOverwrite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [list, setList] = useState(null);

  const form = saveFormView({ symbol, exchange, interval, label, name, nameEdited, bars, canRequest, busy });

  const refresh = useCallback(async () => {
    if (!inBridge || !canView) return;
    const res = unwrap(await window.rama.marketIntel.datasetList({ user }));
    if (res.ok === false) { setMessage(refusalSentence(res)); return; }
    setList(res.datasets || []);
  }, [user, canView]);

  useEffect(() => {
    if (mode === 'list' || mode === 'save') refresh();
  }, [mode, refresh]);

  const save = async () => {
    if (!form.canSave) return;
    setBusy(true);
    setMessage(null);
    const res = unwrap(await window.rama.marketIntel.datasetSave({
      user, symbol, exchange, interval, name: form.name, note,
      fromDate: fromDate || undefined, toDate: toDate || undefined, limit,
      overwrite, sync: unsaved === true, expectBars: Array.isArray(bars) ? bars.length : undefined,
    }));
    setBusy(false);
    if (res.ok === false) { setMessage(refusalSentence(res)); return; }
    setMessage(savedSentence(res));
    setOverwrite(false);
    refresh();
  };

  const load = async (n) => {
    setBusy(true);
    setMessage(null);
    const res = unwrap(await window.rama.marketIntel.datasetLoad({ user, name: n }));
    setBusy(false);
    if (res.ok === false) { setMessage(refusalSentence(res)); return; }
    onView({ meta: res.dataset, bars: res.bars || [] });
  };

  const remove = async (row) => {
    if (!window.confirm(row.deleteQuestion)) return;
    setBusy(true);
    setMessage(null);
    const res = unwrap(await window.rama.marketIntel.datasetDelete({ user, name: row.name }));
    setBusy(false);
    if (res.ok === false) { setMessage(refusalSentence(res)); return; }
    if (viewingName === row.name) onBack();
    setMessage(`Deleted ${row.name}.`);
    refresh();
  };

  if (!mode) return null;
  const rows = datasetRows(list);

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: '8px', padding: '10px 12px',
      border: '1px solid var(--border)', borderRadius: 'var(--radius)',
    }}>
      {mode === 'save' && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <div className="section-label">SAVE THESE CANDLES AS A DATASET</div>
            <InfoTip id="datasetName" />
          </div>
          <div style={{ fontSize: FS.denseLg, color: 'var(--text)', lineHeight: LH.chrome }}>
            {saveSummary({ symbol, interval, fromDate, toDate, bars, unsaved })}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '10px' }}>
            <div>
              <div style={{ fontSize: FS.dense, color: 'var(--muted)', marginBottom: '4px' }}>
                <label htmlFor="dataset-label">LABEL</label>
              </div>
              <input id="dataset-label" className="input" value={label} maxLength={40}
                     onChange={(e) => setLabel(e.target.value)} />
            </div>
            <div>
              <div style={{ fontSize: FS.dense, color: 'var(--muted)', marginBottom: '4px' }}>
                <label htmlFor="dataset-name">NAME</label>
              </div>
              <input id="dataset-name" className="input" value={nameEdited ? name : form.suggested}
                     maxLength={120} spellCheck={false}
                     onChange={(e) => { setName(e.target.value); setNameEdited(true); }} />
            </div>
            <div>
              <div style={{ fontSize: FS.dense, color: 'var(--muted)', marginBottom: '4px' }}>
                <label htmlFor="dataset-note">NOTE (optional)</label>
              </div>
              <input id="dataset-note" className="input" value={note} maxLength={300}
                     onChange={(e) => setNote(e.target.value)} />
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <label style={{ fontSize: FS.denseLg, color: 'var(--text)', display: 'inline-flex', gap: '6px', alignItems: 'center' }}>
              <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
              Overwrite if the name exists
            </label>
            {nameEdited && (
              <button type="button" className="btn btn-sm" onClick={() => { setNameEdited(false); setName(''); }}>
                Use the suggested name
              </button>
            )}
            <div style={{ flex: 1 }} />
            {form.why && (
              <span style={{ fontSize: FS.dense, color: 'var(--amber)', lineHeight: LH.chrome }}>{form.why}</span>
            )}
            <button type="button" className="btn btn-primary" disabled={!form.canSave} onClick={save}>
              Save dataset
            </button>
            <button type="button" className="btn" onClick={() => onMode(null)}>Close</button>
          </div>
        </>
      )}

      {mode === 'list' && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <div className="section-label">SAVED DATASETS</div>
            <InfoTip id="savedDataset" />
            <div style={{ flex: 1 }} />
            <button type="button" className="btn btn-sm" onClick={() => onMode(null)}>Close</button>
          </div>
          {list === null && (
            <span style={{ fontSize: FS.dense, color: 'var(--muted)' }}>Reading…</span>
          )}
          {list !== null && rows.length === 0 && (
            <span style={{ fontSize: FS.denseLg, color: 'var(--muted)', lineHeight: LH.chrome }}>
              Nothing saved yet. Use Save dataset to keep the candles on screen under a name.
            </span>
          )}
          {rows.map((r) => (
            <div key={r.name} style={{
              display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap',
              borderTop: '1px solid var(--border)', paddingTop: '6px',
            }}>
              <div style={{ flex: '1 1 260px', minWidth: 0 }}>
                <div style={{ fontSize: FS.denseLg, color: 'var(--text)', wordBreak: 'break-all' }}>{r.name}</div>
                <div style={{ fontSize: FS.dense, color: 'var(--muted)', lineHeight: LH.chrome }}>
                  {r.bars} · {r.span} · saved {r.saved} · {r.source}{r.note ? ` · ${r.note}` : ''}
                </div>
              </div>
              <button type="button" className="btn btn-sm" disabled={busy || !canView} onClick={() => load(r.name)}>
                {viewingName === r.name ? 'Showing' : 'Load'}
              </button>
              {canRequest && (
                <button type="button" className="btn btn-sm btn-danger" disabled={busy} onClick={() => remove(r)}>
                  Delete
                </button>
              )}
            </div>
          ))}
        </>
      )}

      {message && (
        <div role="status" style={{ fontSize: FS.denseLg, color: 'var(--text-dim)', lineHeight: LH.chrome }}>{message}</div>
      )}
    </div>
  );
}
