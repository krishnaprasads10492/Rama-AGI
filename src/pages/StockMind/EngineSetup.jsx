import React, { useCallback, useEffect, useState } from 'react';
import { FS, LH } from '@config/type.js';
import { stateOf, headline, details, actions, outputLines, shouldPoll } from './engineSetupModel.js';

/**
 * EngineSetup - make the StockMind engine runnable on this machine (spec Section 154).
 *
 * Shown in the ENGINE tab. It reports whether a supported Python (3.10 to 3.12) exists, whether the engine
 * environment exists and imports, and offers the two explicit actions: build the environment, and (Windows,
 * only when winget exists) install Python 3.12 for this user. Neither starts by itself. While a setup runs the
 * panel asks for status every two seconds and stops when it ends.
 */

const inBridge = typeof window !== 'undefined' && !!window.rama?.engineSetup;

export default function EngineSetup({ canConfig }) {
  const [st, setSt] = useState(null);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    const res = await window.rama.engineSetup.status();
    if (res?.ok === false) { setError(res.error || 'The engine state could not be read.'); return null; }
    setError(null);
    setSt(res.data || null);
    return res.data || null;
  }, []);

  useEffect(() => { if (inBridge) refresh(); }, [refresh]);

  useEffect(() => {
    if (!shouldPoll(st)) return undefined;
    const t = setInterval(refresh, 2000);
    return () => clearInterval(t);
  }, [st, refresh]);

  if (!inBridge) return null;

  const begin = async (call) => {
    setError(null);
    const res = await call();
    if (res?.ok === false) { setError(res.error || 'That did not start.'); return; }
    await refresh();
  };

  const state = stateOf(st);
  const act = actions(st, canConfig);
  const lines = outputLines(st);
  const tone = state === 'ready' ? 'var(--green)' : state === 'failed' ? 'var(--red)' : 'var(--gold)';

  return (
    <div className="hud-card" style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <div className="section-label">STOCKMIND ENGINE SETUP</div>
      <div style={{ fontSize: FS.chrome, color: tone, lineHeight: LH.body }} role="status">{headline(st)}</div>
      {details(st).map((d) => (
        <div key={d} style={{ fontSize: FS.denseLg, color: 'var(--text-dim)', lineHeight: LH.body }}>{d}</div>
      ))}
      {error && <div role="alert" style={{ fontSize: FS.denseLg, color: 'var(--red)' }}>{error}</div>}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
        {act.installPython && (
          <button type="button" className="btn btn-sm" onClick={() => begin(() => window.rama.engineSetup.installPython())}
                  title="Runs winget to install Python 3.12 for this user only. It downloads from the internet.">
            INSTALL PYTHON 3.12
          </button>
        )}
        {act.setup && (
          <button type="button" className="btn btn-primary btn-sm" onClick={() => begin(() => window.rama.engineSetup.run())}
                  title="Creates the engine environment and downloads its packages. This can take several minutes.">
            {state === 'failed' ? 'TRY AGAIN' : 'SET UP THE ENGINE'}
          </button>
        )}
        <button type="button" className="btn btn-sm" onClick={refresh}>CHECK AGAIN</button>
        {act.why && <span style={{ fontSize: FS.dense, color: 'var(--muted)' }}>{act.why}</span>}
      </div>
      {lines.length > 0 && (
        <pre style={{ margin: 0, padding: '8px', fontSize: FS.dense, lineHeight: LH.chrome, color: 'var(--muted)', background: 'var(--bg-deep, transparent)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflowX: 'auto', whiteSpace: 'pre-wrap' }}>
          {lines.join('\n')}
        </pre>
      )}
    </div>
  );
}
