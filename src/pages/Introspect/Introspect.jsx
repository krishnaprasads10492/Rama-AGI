import React, { useCallback, useEffect, useState } from 'react';
import { useUserStore } from '@store/userStore.js';

/**
 * Introspect — Meta-Cognitive Self-Audit Nexus + Timeline Flashbacks.
 *
 * This is where Rāma reports on itself honestly: measured success rates, what it
 * has learned about which tool works best, detected regressions, and the git
 * timeline of its own self-modifications with the ability to look back at any
 * past version of a file.
 */

const SEV_COLORS = {
  critical: 'var(--red)',
  warn:     'var(--amber)',
  info:     'var(--muted)',
};

function Stat({ label, value, color = 'var(--text)' }) {
  return (
    <div style={{ textAlign: 'center', minWidth: '90px' }}>
      <div style={{ fontSize: '18px', fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: '9px', color: 'var(--muted)', letterSpacing: '0.1em' }}>{label}</div>
    </div>
  );
}

function Section({ title, children, right }) {
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', margin: '20px 0 10px' }}>
        <span style={{ fontSize: '11px', color: 'var(--text-dim)', letterSpacing: '0.1em', fontWeight: 700 }}>
          {title}
        </span>
        <div style={{ flex: 1 }} />
        {right}
      </div>
      {children}
    </>
  );
}

function Empty({ children }) {
  return (
    <div className="hud-card" style={{ padding: '18px', textAlign: 'center', color: 'var(--muted)', fontSize: '11px' }}>
      {children}
    </div>
  );
}

export default function Introspect() {
  const ipc = typeof window !== 'undefined' ? window.rama : null;
  // The `meta:*` reads now require `mind.view` (Section 89). Declared on the genome from the start,
  // enforced from here on — so every read below must carry the session.
  const currentUser = useUserStore(s => s.currentUser);

  const [summary,     setSummary]     = useState(null);
  const [profiles,    setProfiles]    = useState([]);
  const [vectors,     setVectors]     = useState([]);
  const [regressions, setRegressions] = useState([]);
  const [timeline,    setTimeline]    = useState(null);
  const [flash,       setFlash]       = useState(null);
  const [busy,        setBusy]        = useState(false);
  const [error,       setError]       = useState(null);

  const load = useCallback(async () => {
    if (!ipc?.meta) { setError('Introspection needs the desktop app (Electron IPC unavailable).'); return; }
    try {
      const who = { user: currentUser };
      const [s, p, v, r] = await Promise.all([
        ipc.meta.summary(who),
        ipc.meta.profiles(who),
        ipc.meta.vectors(who),
        ipc.meta.regressions(20, who),
      ]);
      if (s?.ok) setSummary(s.data);
      if (p?.ok) setProfiles(p.data);
      if (v?.ok) setVectors(v.data);
      if (r?.ok) setRegressions(r.data);

      // A denial is reported, not swallowed. Silently rendering empty panels would look like
      // "Rāma has done nothing" rather than "this account may not read that".
      const refused = [s, p, v, r].find(x => x?.ok === false);
      if (refused) { setError(refused.error); return; }

      if (ipc.timeline) {
        const t = await ipc.timeline.get({ limit: 40 });
        if (t?.ok) setTimeline(t.data);
        else setTimeline({ entries: [], unavailable: t?.error });
      }
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, [ipc, currentUser]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!ipc?.meta?.onAudit) return;
    const off = ipc.meta.onAudit(() => load());
    return () => off?.();
  }, [ipc, load]);

  const runAudit = useCallback(async () => {
    setBusy(true);
    try {
      const res = await ipc.meta.audit({ user: currentUser });
      if (res?.ok === false) setError(res.error);
      await load();
    } finally {
      setBusy(false);
    }
  }, [ipc, load, currentUser]);

  const openFlashback = useCallback(async (hash) => {
    setBusy(true);
    try {
      // Show what changed at this point rather than guessing a file
      const res = await ipc.timeline.compare({ from: `${hash}~1`, to: hash });
      setFlash(res?.ok ? { hash, ...res } : { hash, error: res?.error });
    } catch (err) {
      setFlash({ hash, error: err.message });
    } finally {
      setBusy(false);
    }
  }, [ipc]);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        padding: '14px 20px', borderBottom: '1px solid var(--border)',
        background: 'var(--surface)', display: 'flex', alignItems: 'center',
        gap: '12px', flexShrink: 0, flexWrap: 'wrap',
      }}>
        <span style={{ fontSize: '18px' }}>◍</span>
        <span style={{ fontWeight: 700, color: 'var(--gold)', letterSpacing: '0.1em' }}>
          INTROSPECTION
        </span>
        <span style={{ fontSize: '10px', color: 'var(--muted)' }}>
          self-audit · experiential dataset · timeline
        </span>
        <div style={{ flex: 1 }} />
        <button className="btn btn-sm" disabled={busy} onClick={runAudit} style={{ fontSize: '10px' }}>
          Run audit now
        </button>
        <button className="btn btn-sm" disabled={busy} onClick={load} style={{ fontSize: '10px' }}>
          ↻ Refresh
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
        {error && (
          <div className="hud-card" style={{
            padding: '10px 14px', marginBottom: '14px',
            borderColor: 'var(--red)', color: 'var(--red)', fontSize: '11px',
          }}>
            {error}
          </div>
        )}

        {/* Summary */}
        <div className="hud-card" style={{
          padding: '14px 18px', display: 'flex', gap: '18px',
          flexWrap: 'wrap', alignItems: 'center',
        }}>
          <div style={{ fontSize: '10px', color: 'var(--muted)', letterSpacing: '0.1em', flex: '0 0 100%' }}>
            SELF-MEASUREMENT — from Rāma's own recorded outcomes
          </div>
          <Stat label="OUTCOMES"    value={summary?.recorded ?? 0} />
          <Stat label="ACTIONS"     value={summary?.actions ?? 0} />
          <Stat
            label="SUCCESS"
            value={summary?.lastAudit?.successPct != null ? `${summary.lastAudit.successPct}%` : '–'}
            color="var(--green)"
          />
          <Stat
            label="REGRESSIONS"
            value={summary?.regressions ?? 0}
            color={summary?.regressions ? 'var(--red)' : 'var(--muted)'}
          />
          <Stat label="AUDITS" value={summary?.audits ?? 0} />
          <Stat
            label="BASELINE"
            value={summary?.lastAudit?.hasBaseline ? 'SET' : 'NONE'}
            color={summary?.lastAudit?.hasBaseline ? 'var(--green)' : 'var(--amber)'}
          />
        </div>

        {/* Optimization vectors */}
        <Section title="OPTIMIZATION VECTORS — what Rāma learned works better">
          {vectors.length === 0 ? (
            <Empty>
              Not enough evidence yet. Vectors appear once an action has been run with
              two or more tools at least five times each.
            </Empty>
          ) : vectors.map((v, i) => (
            <div key={i} className="hud-card" style={{ padding: '12px 16px', marginBottom: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '11px', color: 'var(--muted)', letterSpacing: '0.08em', minWidth: '110px' }}>
                  {v.action}
                </span>
                <span style={{ fontSize: '12px', color: 'var(--green)', fontWeight: 700 }}>{v.prefer}</span>
                <span style={{ fontSize: '10px', color: 'var(--muted)' }}>over</span>
                <span style={{ fontSize: '12px', color: 'var(--text-dim)' }}>{v.over}</span>
                <div style={{ flex: 1 }} />
                <span style={{ fontSize: '10px', color: 'var(--accent)' }}>
                  confidence {Math.round(v.confidence * 100)}%
                </span>
              </div>
              <div style={{ fontSize: '10px', color: 'var(--text-dim)', marginTop: '4px' }}>{v.reason}</div>
            </div>
          ))}
        </Section>

        {/* Action profiles */}
        <Section title="ACTION PROFILES">
          {profiles.length === 0 ? (
            <Empty>No actions recorded yet.</Empty>
          ) : (
            <div className="hud-card" style={{ padding: '4px 0' }}>
              {profiles.map(p => (
                <div key={p.action} style={{
                  display: 'flex', alignItems: 'center', gap: '12px',
                  padding: '8px 16px', borderBottom: '1px solid var(--border)',
                  fontSize: '11px',
                }}>
                  <span style={{ flex: 1, color: 'var(--text)' }}>{p.action}</span>
                  <span style={{ color: 'var(--muted)', minWidth: '70px' }}>{p.samples} runs</span>
                  <span style={{
                    minWidth: '48px',
                    color: p.successPct >= 90 ? 'var(--green)'
                         : p.successPct >= 70 ? 'var(--amber)' : 'var(--red)',
                  }}>
                    {p.successPct}%
                  </span>
                  <span style={{ color: 'var(--text-dim)', minWidth: '80px', textAlign: 'right' }}>
                    {p.avgMs != null ? `${p.avgMs}ms avg` : '–'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* Regressions */}
        <Section title="DETECTED REGRESSIONS">
          {regressions.length === 0 ? (
            <Empty>No regressions detected against the current baseline.</Empty>
          ) : regressions.map((r, i) => (
            <div key={i} className="hud-card" style={{
              padding: '10px 16px', marginBottom: '6px',
              borderLeft: `2px solid ${SEV_COLORS[r.severity] ?? 'var(--muted)'}`,
            }}>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '10px', color: SEV_COLORS[r.severity], letterSpacing: '0.08em' }}>
                  {String(r.severity).toUpperCase()}
                </span>
                <span style={{ fontSize: '11px', color: 'var(--text)' }}>{r.action}</span>
                <span style={{ fontSize: '10px', color: 'var(--muted)' }}>{r.type}</span>
                <div style={{ flex: 1 }} />
                <span style={{ fontSize: '10px', color: 'var(--text-dim)' }}>{r.detail}</span>
              </div>
            </div>
          ))}
        </Section>

        {/* Timeline */}
        <Section title="TIMELINE FLASHBACKS">
          {!timeline ? (
            <Empty>Loading timeline...</Empty>
          ) : timeline.unavailable ? (
            <Empty>Timeline unavailable: {timeline.unavailable}</Empty>
          ) : timeline.entries.length === 0 ? (
            <Empty>No commits found in Rāma's repository.</Empty>
          ) : (
            <div className="hud-card" style={{ padding: '4px 0' }}>
              {timeline.entries.map(e => (
                <div key={e.hash} style={{
                  display: 'flex', alignItems: 'center', gap: '12px',
                  padding: '8px 16px', borderBottom: '1px solid var(--border)',
                  fontSize: '11px',
                }}>
                  <span style={{
                    width: '6px', height: '6px', borderRadius: '50%', flexShrink: 0,
                    background: e.bySelf ? 'var(--violet)' : 'var(--border)',
                    boxShadow: e.bySelf ? '0 0 6px var(--violet)' : 'none',
                  }} title={e.bySelf ? 'Self-modification' : 'Manual change'} />
                  <span style={{ color: 'var(--accent)', fontFamily: 'monospace', minWidth: '70px' }}>
                    {e.short}
                  </span>
                  <span style={{ flex: 1, color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {e.message}
                  </span>
                  {e.markers.length > 0 && (
                    <span className="badge" style={{
                      background: 'rgba(119,0,255,0.15)', color: 'var(--violet)',
                      fontSize: '9px', padding: '1px 6px', borderRadius: '2px',
                    }}>
                      {e.markers.length} marker{e.markers.length > 1 ? 's' : ''}
                    </span>
                  )}
                  <button className="btn btn-sm" disabled={busy}
                    onClick={() => openFlashback(e.hash)} style={{ fontSize: '9px', padding: '2px 7px' }}>
                    Flashback
                  </button>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* Flashback detail */}
        {flash && (
          <div className="hud-card" style={{ padding: '14px 16px', marginTop: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
              <span style={{ fontSize: '10px', color: 'var(--muted)', letterSpacing: '0.1em' }}>
                FLASHBACK {String(flash.hash).slice(0, 8)}
              </span>
              <div style={{ flex: 1 }} />
              <button className="btn btn-sm" onClick={() => setFlash(null)} style={{ fontSize: '9px' }}>Close</button>
            </div>
            {flash.error ? (
              <div style={{ fontSize: '11px', color: 'var(--red)' }}>{flash.error}</div>
            ) : (
              <>
                <div style={{ fontSize: '10px', color: 'var(--text-dim)', marginBottom: '8px' }}>
                  +{flash.insertions ?? 0} / −{flash.deletions ?? 0} across {flash.files?.length ?? 0} file(s)
                </div>
                <pre style={{
                  background: 'var(--surface)', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)', padding: '10px', fontSize: '10px',
                  color: 'var(--text-dim)', maxHeight: '300px', overflow: 'auto',
                  whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0,
                }}>
                  {(flash.diff || '').slice(0, 8000) || 'No textual diff.'}
                </pre>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
