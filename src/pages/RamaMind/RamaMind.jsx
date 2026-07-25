import React, { useEffect, useState, useCallback } from 'react';
import { getRamaStatus, CAPABILITY_AXES, ramaMemory, ramaWorld,
         ramaProactive, ramaRevision } from '@services/ramaCore.js';
import RamaOrb from '@components/RamaOrb.jsx';

/**
 * RamaMind — Rāma's self-awareness dashboard.
 * Shows all 10 capability axes, memory state, world model,
 * proactive triggers, and self-improvement insights.
 * This is the "cockpit" of the AGI — visible only to master.
 */

function CapabilityBar({ axis, data }) {
  const hue = data.score >= 8 ? 'var(--green)' : data.score >= 6 ? 'var(--accent)' : 'var(--amber)';
  return (
    <div style={{ marginBottom: '10px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
        <span style={{ fontSize: '11px', color: 'var(--text)', fontWeight: 600 }}>{data.label}</span>
        <span style={{ fontSize: '11px', color: hue, fontWeight: 700 }}>{data.score}/10</span>
      </div>
      <div style={{ height: '4px', background: 'var(--border)', borderRadius: '2px', overflow: 'hidden' }}>
        <div style={{ width: `${data.score * 10}%`, height: '100%', background: hue,
          boxShadow: `0 0 6px ${hue}88`, transition: 'width 0.8s ease' }} />
      </div>
      <div style={{ fontSize: '10px', color: 'var(--muted)', marginTop: '2px' }}>{data.desc}</div>
    </div>
  );
}

function MemoryPanel({ memory }) {
  return (
    <div className="hud-card" style={{ padding: '16px' }}>
      <div className="section-label" style={{ marginBottom: '12px' }}>◈ MEMORY SYSTEM (CoALA Framework)</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
        {[
          { layer: 'Working',    color: 'var(--accent)',  count: memory?.working?.recentMessages?.length ?? 0, desc: 'Current session context' },
          { layer: 'Episodic',   color: 'var(--violet)',  count: memory?.episodicCount ?? 0,  desc: 'Past interactions & events' },
          { layer: 'Semantic',   color: 'var(--green)',   count: memory?.semanticCount ?? 0,  desc: 'Facts & preferences learned' },
          { layer: 'Procedural', color: 'var(--amber)',   count: 0,                            desc: 'Learned skills & recipes' },
        ].map(m => (
          <div key={m.layer} style={{ background: 'var(--surface)', borderRadius: 'var(--radius)',
            border: `1px solid ${m.color}33`, padding: '10px' }}>
            <div style={{ fontSize: '10px', color: m.color, fontWeight: 700, letterSpacing: '0.08em' }}>{m.layer}</div>
            <div style={{ fontSize: '20px', fontWeight: 700, color: m.color, marginTop: '4px' }}>{m.count}</div>
            <div style={{ fontSize: '10px', color: 'var(--muted)' }}>{m.desc}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function WorldModelPanel({ world }) {
  if (!world) return null;
  return (
    <div className="hud-card" style={{ padding: '16px' }}>
      <div className="section-label" style={{ marginBottom: '12px' }}>🌐 WORLD MODEL</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {[
          ['Master',    world.master?.name],
          ['Timezone',  world.master?.timezone],
          ['Platform',  world.system?.os || 'Detecting...'],
          ['Projects',  `${world.system?.projects?.length ?? 0} detected`],
          ['Goals',     `${world.master?.goals?.length ?? 0} active`],
          ['Pending tasks', `${world.pending ?? 0}`],
          ['Scheduled', `${world.scheduled ?? 0}`],
        ].map(([k, v]) => (
          <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0',
            borderBottom: '1px solid var(--border)' }}>
            <span style={{ fontSize: '11px', color: 'var(--muted)' }}>{k}</span>
            <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ImprovementsPanel({ improvements, onDismiss }) {
  if (!improvements?.length) {
    return (
      <div className="hud-card" style={{ padding: '16px' }}>
        <div className="section-label" style={{ marginBottom: '12px' }}>⚡ SELF-REVISION INSIGHTS</div>
        <div style={{ color: 'var(--muted)', fontSize: '12px', textAlign: 'center', padding: '12px' }}>
          No improvement insights yet. Rāma learns from interactions.
        </div>
      </div>
    );
  }
  const priorityColor = { high: 'var(--red)', medium: 'var(--amber)', low: 'var(--muted)' };
  return (
    <div className="hud-card" style={{ padding: '16px' }}>
      <div className="section-label" style={{ marginBottom: '12px' }}>⚡ SELF-REVISION INSIGHTS ({improvements.length})</div>
      {improvements.map((imp, i) => (
        <div key={i} style={{ padding: '10px', marginBottom: '6px', borderRadius: 'var(--radius)',
          background: 'var(--surface)', border: `1px solid ${priorityColor[imp.priority]}44` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
            <span style={{ fontSize: '10px', color: priorityColor[imp.priority], fontWeight: 700, textTransform: 'uppercase' }}>
              {imp.priority} priority · {imp.type}
            </span>
            <button onClick={() => onDismiss(i)} style={{ background: 'none', border: 'none',
              color: 'var(--muted)', cursor: 'pointer', fontSize: '10px', fontFamily: 'var(--font)' }}>✕</button>
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text)', marginBottom: '4px' }}>{imp.finding}</div>
          <div style={{ fontSize: '11px', color: 'var(--accent)' }}>→ {imp.action}</div>
        </div>
      ))}
    </div>
  );
}

export default function RamaMind() {
  const [status,       setStatus]       = useState(null);
  const [improvements, setImprovements] = useState([]);
  const [tab,          setTab]          = useState('capabilities');

  const refresh = useCallback(() => {
    const s = getRamaStatus();
    setStatus(s);
    setImprovements(ramaRevision.getImprovements());
  }, []);

  useEffect(() => { refresh(); const id = setInterval(refresh, 5000); return () => clearInterval(id); }, [refresh]);

  const dismissImprovement = (i) => { ramaRevision.clearImprovement(i); refresh(); };
  const axes = Object.entries(CAPABILITY_AXES);

  // AAI composite score (geometric mean proxy)
  const aaiScore = axes.length
    ? (axes.reduce((p, [, d]) => p * d.score, 1) ** (1 / axes.length)).toFixed(1)
    : '?';

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', background: 'var(--surface)',
        display: 'flex', alignItems: 'center', gap: '14px', flexShrink: 0 }}>
        <RamaOrb size={32} />
        <div>
          <div style={{ fontWeight: 700, color: 'var(--violet)', letterSpacing: '0.1em' }}>RĀMA MIND</div>
          <div style={{ fontSize: '10px', color: 'var(--muted)' }}>AGI Consciousness Dashboard · 10 Capability Axes</div>
        </div>
        <div className="metric-pill" style={{ marginLeft: 'auto', borderColor: 'var(--violet)44' }}>
          <span style={{ color: 'var(--muted)', fontSize: '10px' }}>AAI Index</span>
          <span style={{ color: 'var(--violet)', fontWeight: 700, fontSize: '14px' }}>{aaiScore}</span>
        </div>
        <button className="btn btn-sm" onClick={refresh}>↺</button>
      </div>

      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', background: 'var(--surface)', flexShrink: 0 }}>
        {['capabilities', 'memory', 'world', 'proactive', 'self-revision'].map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: '8px 14px', border: 'none', background: 'transparent',
            color: tab === t ? 'var(--violet)' : 'var(--muted)',
            borderBottom: tab === t ? '2px solid var(--violet)' : '2px solid transparent',
            cursor: 'pointer', fontFamily: 'var(--font)', fontSize: '10px',
            textTransform: 'uppercase', letterSpacing: '0.06em',
          }}>{t}</button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '20px', minHeight: 0 }}>
        {tab === 'capabilities' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 32px' }}>
            {axes.map(([key, data]) => <CapabilityBar key={key} axis={key} data={data} />)}
          </div>
        )}
        {tab === 'memory' && <MemoryPanel memory={status?.memory} />}
        {tab === 'world'  && <WorldModelPanel world={status?.world} />}
        {tab === 'proactive' && (
          <div className="hud-card" style={{ padding: '16px' }}>
            <div className="section-label" style={{ marginBottom: '12px' }}>⚡ PROACTIVE TRIGGERS</div>
            {ramaProactive.getTriggers().map((t, i) => (
              <div key={i} style={{ padding: '10px', marginBottom: '6px', background: 'var(--surface)',
                borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--amber)' }}>{t.name}</span>
                  <span className="badge badge-amber" style={{ fontSize: '9px' }}>{t.type}</span>
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-dim)', marginTop: '4px' }}>{t.desc}</div>
              </div>
            ))}
          </div>
        )}
        {tab === 'self-revision' && (
          <ImprovementsPanel improvements={improvements} onDismiss={dismissImprovement} />
        )}
      </div>
    </div>
  );
}
