import { useCallback, useEffect, useState } from 'react';
import { FS, LH } from '@config/type.js';
import { build, checks, headline, lastCrash, oneLine, repair, rows, state, unregistered } from './healthModel.js';

/**
 * HealthPanel — what the app found wrong with itself at startup (spec Section 187)
 *
 * `window.rama.health.startup` has existed since Section 49 and nothing in `src/` ever called it,
 * so the diagnosis went to `console.warn` — which a packaged app does not have. Everything Sections
 * 183.2 and 183.3 added was therefore invisible on an installed instance, and master had to
 * photograph a build log to learn what his own app already knew.
 *
 * READ ON MOUNT, UNLIKE THE SECURITY PANEL. The distinction is cost: this is a read of a value the
 * main process computed once at startup, so it is a single cheap IPC call. `SecurityPanel` shells
 * out to `npm audit` for the better part of a minute, which is why that one is a button
 * (Section 182.2). A panel should not make master ask for something free.
 *
 * REPAIR IS STILL A BUTTON, and its limit is printed before it: a repair fetches packages, and a
 * native module needs a compiler, so argon2 and node-pty are beyond it however many times it runs
 * (Section 183.6). Every sentence comes from `healthModel.js`; this file lays them out.
 */
export default function HealthPanel() {
  const [payload, setPayload] = useState(null);
  const [busy, setBusy] = useState(false);
  const [showChecks, setShowChecks] = useState(false);

  const read = useCallback(async () => {
    // An unregistered channel resolves to undefined and an absent bridge throws; both become a
    // reported failure rather than an empty panel, which would be indistinguishable from "fine".
    const res = await window.rama?.health?.startup?.()
      ?.catch((err) => ({ ok: false, error: err.message }));
    setPayload(res ?? { ok: false, error: 'The startup diagnosis channel did not answer.' });
  }, []);

  useEffect(() => { read(); }, [read]);

  const runRepair = useCallback(async () => {
    setBusy(true);
    await window.rama?.health?.repair?.()?.catch(() => null);
    // Re-read rather than trusting the repair's own return: the diagnosis is re-run in the main
    // process afterwards, and that re-run is the authority on what is still wrong.
    await read();
    setBusy(false);
  }, [read]);

  const s = state(payload);
  const h = headline(payload);
  const b = build(payload);
  const findings = rows(payload);
  const list = checks(payload);
  const crash = lastCrash(payload);
  const rep = repair(payload);
  const dead = unregistered(payload);

  const tone = (cls) => (cls === 'fatal' ? 'var(--red)'
    : cls === 'unexpected' ? 'var(--amber)' : 'var(--muted)');

  return (
    <div className="hud-card" style={{ padding: '16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
        <div className="section-label">STARTUP DIAGNOSIS</div>
        <span style={{ fontSize: FS.chrome, lineHeight: LH.chrome, color: 'var(--muted)' }}>
          {oneLine(payload)}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button className="btn btn-sm" onClick={read} disabled={busy}>Re-read</button>
          <button className="btn btn-sm" onClick={runRepair} disabled={busy || s.kind !== 'ready'}>
            {busy ? 'Repairing…' : 'Attempt repair'}
          </button>
        </div>
      </div>

      <div style={{
        fontSize: FS.chrome,
        lineHeight: 1.6,
        marginBottom: 10,
        color: s.kind === 'failed' ? 'var(--red)' : s.kind === 'not-run' ? 'var(--amber)' : 'var(--text-dim)',
      }}>
        <strong>{s.title}</strong>
        {s.detail ? <span> — {s.detail}</span> : null}
      </div>

      {s.kind === 'ready' ? (
        <>
          {/* Three counts, kept apart. A fault, a degradation this build did not expect, and one it
              recorded in advance are three different things to a reader deciding whether to act. */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8, marginBottom: 10 }}>
            {[
              ['Faults', h.fatal, 'var(--red)'],
              ['Unexpected', h.unexpected, 'var(--amber)'],
              ['Known at build', h.expected, 'var(--muted)'],
              ['Checks passed', h.checksPassed === null ? '—' : `${h.checksPassed}/${h.checksRun}`, 'var(--text)'],
            ].map(([label, value, colour]) => (
              <div key={label} style={{ padding: '10px 12px', background: 'var(--surface)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
                <div style={{ fontSize: FS.chrome, lineHeight: LH.chrome, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  {label}
                </div>
                <div style={{ fontSize: FS.h2, lineHeight: LH.head, fontWeight: 700, color: colour, marginTop: 2 }}>
                  {value}
                </div>
              </div>
            ))}
          </div>

          <div style={{ fontSize: FS.chrome, lineHeight: 1.6, color: 'var(--text-dim)', marginBottom: 10 }}>
            This installation is <strong>{h.verdict}</strong>. {h.caveat}
          </div>

          {/* The previous run's crash. Shown near the top because it is the fault most easily
              forgotten, and labelled as the PREVIOUS run so nobody hunts a current one. */}
          {crash ? (
            <div style={{ padding: '10px 12px', marginBottom: 10, borderRadius: 'var(--radius)', border: '1px solid var(--red)', background: 'var(--surface)', fontSize: FS.chrome, lineHeight: 1.6 }}>
              <strong style={{ color: 'var(--red)' }}>Previous launch ended in a crash</strong>
              <div style={{ color: 'var(--text)' }}>{crash.message}</div>
              {crash.at ? <div style={{ color: 'var(--muted)' }}>{String(crash.at)}</div> : null}
              <div style={{ color: 'var(--muted)' }}>{crash.note}</div>
            </div>
          ) : null}

          {findings.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10 }}>
              {findings.map((f) => (
                <div key={`${f.cls}-${f.id}`} style={{ padding: '10px 12px', background: 'var(--surface)', borderRadius: 'var(--radius)', border: `1px solid ${tone(f.cls)}` }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: FS.chrome, lineHeight: LH.chrome, textTransform: 'uppercase', letterSpacing: '0.06em', color: tone(f.cls) }}>
                      {f.label}
                    </span>
                    {f.module ? <strong style={{ color: 'var(--text)' }}>{f.module}</strong> : null}
                  </div>
                  <div style={{ fontSize: FS.chrome, lineHeight: 1.6, color: 'var(--text-dim)', marginTop: 4 }}>{f.detail}</div>
                  {f.remedy ? <div style={{ fontSize: FS.chrome, lineHeight: 1.6, color: 'var(--text)', marginTop: 4 }}>→ {f.remedy}</div> : null}
                  {/* Said on the row, not only beside the button: a reader looking at this finding
                      needs to know the repair cannot touch it. */}
                  {f.fetchable === false ? (
                    <div style={{ fontSize: FS.chrome, lineHeight: 1.6, color: 'var(--muted)', marginTop: 4 }}>
                      A repair cannot fix this — it needs a compiler, not a download.
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}

          {/* Subsystems whose IPC never registered. Without this the only symptom is
              "No handler registered" at whichever call site master touches first. */}
          {dead.length > 0 ? (
            <div style={{ marginBottom: 10, fontSize: FS.chrome, lineHeight: 1.6, color: 'var(--amber)' }}>
              <strong>Channels that never registered:</strong>
              <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                {dead.map((x) => <li key={x.label}>{x.label} — {x.error}</li>)}
              </ul>
            </div>
          ) : null}

          {/* What the build recorded about itself, which is what lets a degradation read as an
              accepted trade-off rather than as damage (Section 183.3). */}
          {b ? (
            <div style={{ padding: '10px 12px', marginBottom: 10, background: 'var(--surface)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', fontSize: FS.chrome, lineHeight: 1.6, color: 'var(--text-dim)' }}>
              <div style={{ color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>This build</div>
              <div>
                {b.version || '—'} built {b.builtAt || '—'} on {b.builtOn || '—'}
                {b.nodeAtBuild ? ` with Node ${b.nodeAtBuild}` : ''}
                {b.verdict ? ` · readiness ${b.verdict}` : ''}
              </div>
              {b.nativeRebuilt === false ? (
                <div style={{ color: 'var(--amber)', marginTop: 4 }}>
                  Native modules did not compile for this build: {b.nativeDegraded.join(', ') || '—'}
                  <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                    {b.nativeConsequences.map((c, i) => <li key={i}>{c}</li>)}
                  </ul>
                </div>
              ) : null}
              {b.nativeRebuilt === null ? (
                <div style={{ color: 'var(--muted)', marginTop: 4 }}>
                  Whether native modules compiled was not recorded, so it is unknown rather than fine.
                </div>
              ) : null}
            </div>
          ) : null}

          {/* THE REPAIR'S LIMIT, BEFORE THE BUTTON IS USED. */}
          <div style={{ fontSize: FS.chrome, lineHeight: 1.6, color: 'var(--muted)', marginBottom: 10 }}>
            {rep.can} {rep.cannot}
            {rep.unfixableNote ? <> <span style={{ color: 'var(--amber)' }}>{rep.unfixableNote}</span></> : null}
          </div>

          {rep.last ? (
            <div style={{ fontSize: FS.chrome, lineHeight: 1.6, color: 'var(--text-dim)', marginBottom: 10 }}>
              <strong>Last repair:</strong> attempted {rep.last.attempted.length}, repaired{' '}
              {rep.last.repaired.length}, recovered {rep.last.recovered.length}, still missing{' '}
              {rep.last.remaining.length}
              {rep.last.notes.length > 0 ? (
                <ul style={{ margin: '4px 0 0', paddingLeft: 18, color: 'var(--muted)' }}>
                  {rep.last.notes.map((n, i) => <li key={i}>{n}</li>)}
                </ul>
              ) : null}
            </div>
          ) : null}

          {list.length > 0 ? (
            <>
              <button className="btn btn-sm" onClick={() => setShowChecks(!showChecks)}>
                {showChecks ? 'Hide the check list' : `Show all ${list.length} checks`}
              </button>
              {showChecks ? (
                <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 6 }}>
                  {list.map((c) => (
                    <div key={c.label} style={{ fontSize: FS.chrome, lineHeight: 1.5, color: c.pass ? 'var(--text-dim)' : 'var(--amber)' }}>
                      {c.pass ? '✓' : '✗'} {c.label}
                      {c.note ? <span style={{ color: 'var(--muted)' }}> — {c.note}</span> : null}
                    </div>
                  ))}
                </div>
              ) : null}
            </>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
