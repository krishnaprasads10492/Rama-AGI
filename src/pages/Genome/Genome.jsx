import React, { useCallback, useEffect, useMemo, useState } from 'react';

/**
 * Genome — Rāma's capability genome and instance lattice.
 *
 * Three things this page makes visible that were previously invisible:
 *   1. Which genes are actually live on this machine (measured, not claimed)
 *   2. Which instances exist, what they express, and what stays dormant
 *   3. Who could take over a role if an instance died (holonic resilience)
 */

const DOMAIN_COLORS = {
  'perception':      'var(--accent)',
  'reasoning':       'var(--violet)',
  'action':          'var(--green)',
  'memory':          'var(--gold)',
  'coordination':    'var(--accent)',
  'security':        'var(--magenta)',
  'self-evolution':  'var(--violet)',
  'governance':      'var(--gold)',
};

const STATUS_COLORS = {
  active:     'var(--green)',
  starting:   'var(--accent)',
  idle:       'var(--muted)',
  suspended:  'var(--amber)',
  terminated: 'var(--red)',
};

// ─── Small building blocks ────────────────────────────────────────────────────
function Stat({ label, value, color = 'var(--text)' }) {
  return (
    <div style={{ textAlign: 'center', minWidth: '84px' }}>
      <div style={{ fontSize: '18px', fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: '9px', color: 'var(--muted)', letterSpacing: '0.1em' }}>{label}</div>
    </div>
  );
}

function GeneChip({ gene, expressed, live }) {
  const color = DOMAIN_COLORS[gene.domain] ?? 'var(--accent)';
  return (
    <div
      title={`${gene.label}\ndomain: ${gene.domain}\nengine: ${gene.engine}\nrequires: ${gene.cap}${live === false ? '\n⚠ engine not resolvable' : ''}`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '6px',
        padding: '4px 9px', borderRadius: '3px',
        border: `1px solid ${expressed ? color : 'var(--border)'}`,
        background: expressed ? `${color}18` : 'transparent',
        color: expressed ? color : 'var(--muted)',
        fontSize: '10px', letterSpacing: '0.04em',
        opacity: live === false ? 0.45 : 1,
      }}
    >
      <span style={{
        width: '5px', height: '5px', borderRadius: '50%',
        background: live === false ? 'var(--red)' : expressed ? color : 'var(--border)',
      }} />
      {gene.label}
      {!expressed && <span style={{ fontSize: '8px', opacity: 0.7 }}>dormant</span>}
    </div>
  );
}

function InstanceCard({ inst, genes, onSuspend, onResume, onTerminate, onExpress, busy }) {
  const [open, setOpen] = useState(false);
  const color = STATUS_COLORS[inst.status] ?? 'var(--muted)';
  const expressedSet = useMemo(() => new Set(inst.expressed || []), [inst.expressed]);

  return (
    <div className="hud-card" style={{ padding: '14px 16px', marginBottom: '10px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
        <span style={{
          width: '8px', height: '8px', borderRadius: '50%', background: color,
          boxShadow: `0 0 8px ${color}`, flexShrink: 0,
        }} />
        <div style={{ flex: 1, minWidth: '180px' }}>
          <div style={{ fontWeight: 700, fontSize: '13px', color: 'var(--text)' }}>
            {inst.label}
            <span style={{ color: 'var(--muted)', fontWeight: 400, fontSize: '10px', marginLeft: '8px' }}>
              {inst.id}
            </span>
          </div>
          <div style={{ fontSize: '10px', color: 'var(--muted)' }}>{inst.purpose}</div>
        </div>

        <span className="badge" style={{
          background: `${color}22`, color, border: `1px solid ${color}55`,
          fontSize: '9px', padding: '2px 8px', borderRadius: '2px',
        }}>
          {String(inst.status).toUpperCase()}
        </span>

        <div style={{ fontSize: '10px', color: 'var(--text-dim)', textAlign: 'right' }}>
          <div>{inst.expressed?.length ?? 0} expressed · {inst.dormant?.length ?? 0} dormant</div>
          <div style={{ color: 'var(--muted)' }}>genome {String(inst.genomeHash || '').slice(0, 8)}</div>
        </div>

        <button className="btn btn-sm" onClick={() => setOpen(o => !o)} style={{ fontSize: '10px' }}>
          {open ? 'Hide genes' : 'Genes'}
        </button>
        {inst.status === 'suspended'
          ? <button className="btn btn-sm" disabled={busy} onClick={() => onResume(inst.id)} style={{ fontSize: '10px' }}>Resume</button>
          : <button className="btn btn-sm" disabled={busy || inst.role === 'prime'} onClick={() => onSuspend(inst.id)} style={{ fontSize: '10px' }}>Suspend</button>}
        <button className="btn btn-sm btn-danger" disabled={busy || inst.role === 'prime'}
          onClick={() => onTerminate(inst.id)} style={{ fontSize: '10px' }}>
          Terminate
        </button>
      </div>

      {open && (
        <div style={{ marginTop: '12px', display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
          {genes.map(g => (
            <span key={g.id} onClick={() => !expressedSet.has(g.id) && onExpress(inst.id, g.id)}
              style={{ cursor: expressedSet.has(g.id) ? 'default' : 'pointer' }}
              title={expressedSet.has(g.id) ? undefined : 'Click to express this dormant gene'}>
              <GeneChip gene={g} expressed={expressedSet.has(g.id)} />
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function Genome() {
  const ipc = typeof window !== 'undefined' ? window.rama : null;

  const [genome,   setGenome]   = useState(null);
  const [verify,   setVerify]   = useState(null);
  const [insts,    setInsts]    = useState([]);
  const [stats,    setStats]    = useState(null);
  const [role,     setRole]     = useState('strategic-optimizer');
  const [busy,     setBusy]     = useState(false);
  const [error,    setError]    = useState(null);
  const [failover, setFailover] = useState(null);

  const load = useCallback(async () => {
    if (!ipc?.genome) { setError('Genome layer needs the desktop app (Electron IPC unavailable).'); return; }
    try {
      const [g, v, l, s] = await Promise.all([
        ipc.genome.get(),
        ipc.genome.verify(),
        ipc.instance.list(),
        ipc.instance.stats(),
      ]);
      if (g?.ok) setGenome(g.data);
      if (v?.ok) setVerify(v.data);
      if (l?.ok) setInsts(l.data);
      if (s?.ok) setStats(s.data);
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, [ipc]);

  useEffect(() => { load(); }, [load]);

  // Live lifecycle updates
  useEffect(() => {
    if (!ipc?.instance?.on) return;
    const offs = ['spawned', 'suspended', 'resumed', 'terminated', 'expressed']
      .map(evt => ipc.instance.on(evt, () => load()));
    return () => offs.forEach(off => off?.());
  }, [ipc, load]);

  const liveMap = useMemo(() => {
    const m = new Map();
    (verify?.genes || []).forEach(g => m.set(g.id, g.live));
    return m;
  }, [verify]);

  const act = useCallback(async (fn) => {
    setBusy(true);
    try {
      const res = await fn();
      if (res && res.ok === false) setError(res.error);
      else setError(null);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }, [load]);

  const genesByDomain = useMemo(() => {
    const out = {};
    for (const g of genome?.genes || []) {
      (out[g.domain] ??= []).push(g);
    }
    return out;
  }, [genome]);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        padding: '14px 20px', borderBottom: '1px solid var(--border)',
        background: 'var(--surface)', display: 'flex', alignItems: 'center',
        gap: '12px', flexShrink: 0, flexWrap: 'wrap',
      }}>
        <span style={{ fontSize: '18px' }}>⟠</span>
        <span style={{ fontWeight: 700, color: 'var(--violet)', letterSpacing: '0.1em' }}>
          GENOME &amp; INSTANCES
        </span>
        {genome && (
          <span className="badge" style={{
            background: 'rgba(119,0,255,0.13)', color: 'var(--violet)',
            border: '1px solid rgba(119,0,255,0.35)', fontSize: '9px',
            padding: '2px 8px', borderRadius: '2px',
          }}>
            v{genome.version} · {genome.hash?.slice(0, 12)}
          </span>
        )}
        {genome && !genome.identityAvailable && (
          <span className="badge" style={{
            background: 'rgba(255,170,0,0.13)', color: 'var(--amber)',
            border: '1px solid rgba(255,170,0,0.35)', fontSize: '9px',
            padding: '2px 8px', borderRadius: '2px',
          }}>
            NUCLEUS LOCKED — IDENTITY MASKED
          </span>
        )}
        <div style={{ flex: 1 }} />
        <button className="btn btn-sm" onClick={load} disabled={busy} style={{ fontSize: '10px' }}>
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

        {/* Genome health */}
        <div className="hud-card" style={{
          padding: '14px 18px', marginBottom: '16px',
          display: 'flex', gap: '18px', flexWrap: 'wrap', alignItems: 'center',
        }}>
          <div style={{ fontSize: '10px', color: 'var(--muted)', letterSpacing: '0.1em', flex: '0 0 100%' }}>
            GENOME HEALTH — measured on this machine, not declared
          </div>
          <Stat label="GENES"    value={verify?.total ?? '–'} />
          <Stat label="LIVE"     value={verify?.live ?? '–'}     color="var(--green)" />
          <Stat label="DEGRADED" value={verify?.degraded ?? '–'} color={verify?.degraded ? 'var(--red)' : 'var(--muted)'} />
          <Stat label="DOMAINS"  value={genome?.domains?.length ?? '–'} />
          <Stat label="INSTANCES" value={`${stats?.total ?? 0}/${stats?.cap ?? 0}`} />
          <Stat
            label="GENOME SYNC"
            value={stats?.genomeConsistent === false ? 'DRIFT' : 'OK'}
            color={stats?.genomeConsistent === false ? 'var(--red)' : 'var(--green)'}
          />
        </div>

        {/* Instances */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '11px', color: 'var(--text-dim)', letterSpacing: '0.1em', fontWeight: 700 }}>
            INSTANCES
          </span>
          <div style={{ flex: 1 }} />
          <select
            value={role}
            onChange={e => setRole(e.target.value)}
            style={{
              background: 'var(--surface)', color: 'var(--text)',
              border: '1px solid var(--border)', borderRadius: 'var(--radius)',
              padding: '4px 8px', fontSize: '11px', fontFamily: 'var(--font)',
            }}
          >
            {Object.entries(genome?.roles || {}).map(([key, r]) => (
              <option key={key} value={key}>{r.label}</option>
            ))}
          </select>
          <button className="btn btn-sm btn-primary" disabled={busy}
            onClick={() => act(() => ipc.instance.spawn({ role }))} style={{ fontSize: '10px' }}>
            + Spawn
          </button>
          <button className="btn btn-sm" disabled={busy}
            onClick={() => act(() => ipc.instance.ensurePrime())} style={{ fontSize: '10px' }}>
            Ensure Prime
          </button>
          <button className="btn btn-sm" disabled={busy}
            onClick={async () => {
              const res = await ipc.instance.failover(role);
              setFailover(res?.ok ? res.data : []);
            }}
            style={{ fontSize: '10px' }}>
            Failover check
          </button>
        </div>

        {insts.length === 0 && (
          <div className="hud-card" style={{ padding: '20px', textAlign: 'center', color: 'var(--muted)', fontSize: '11px', marginBottom: '16px' }}>
            No instances yet. Spawn one, or click Ensure Prime to bring up the master-facing Rāma.
          </div>
        )}

        {insts.map(inst => (
          <InstanceCard
            key={inst.id}
            inst={inst}
            genes={genome?.genes || []}
            busy={busy}
            onSuspend={(id)     => act(() => ipc.instance.suspend(id))}
            onResume={(id)      => act(() => ipc.instance.resume(id))}
            onTerminate={(id)   => act(() => ipc.instance.terminate(id))}
            onExpress={(id, g)  => act(() => ipc.instance.express(id, g))}
          />
        ))}

        {failover && (
          <div className="hud-card" style={{ padding: '12px 16px', margin: '10px 0 16px' }}>
            <div style={{ fontSize: '10px', color: 'var(--muted)', letterSpacing: '0.1em', marginBottom: '8px' }}>
              FAILOVER CANDIDATES FOR {String(genome?.roles?.[role]?.label || role).toUpperCase()}
            </div>
            {failover.length === 0 ? (
              <div style={{ fontSize: '11px', color: 'var(--amber)' }}>
                No running instance could take over this role right now.
              </div>
            ) : failover.map(c => (
              <div key={c.id} style={{ fontSize: '11px', color: 'var(--text-dim)', marginBottom: '4px' }}>
                <span style={{ color: 'var(--green)' }}>✓</span> {c.id} ({c.role}) —{' '}
                {c.needsExpressing.length === 0
                  ? 'ready immediately'
                  : `would express ${c.needsExpressing.length} dormant gene(s)`}
              </div>
            ))}
          </div>
        )}

        {/* Gene map */}
        <div style={{ fontSize: '11px', color: 'var(--text-dim)', letterSpacing: '0.1em', fontWeight: 700, margin: '20px 0 10px' }}>
          GENE MAP
        </div>
        {Object.entries(genesByDomain).map(([domain, genes]) => (
          <div key={domain} className="hud-card" style={{ padding: '12px 16px', marginBottom: '8px' }}>
            <div style={{
              fontSize: '10px', letterSpacing: '0.1em', marginBottom: '8px',
              color: DOMAIN_COLORS[domain] ?? 'var(--accent)', fontWeight: 700,
            }}>
              {domain.toUpperCase()} · {genes.length}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {genes.map(g => (
                <GeneChip key={g.id} gene={g} expressed live={liveMap.get(g.id)} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
