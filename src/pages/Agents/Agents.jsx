import React, { useEffect, useState, useCallback } from 'react';
import { useAgentStore } from '@store/agentStore.js';

const isElectron = typeof window !== 'undefined' && !!window.rama;

const AGENT_TYPES = [
  { type: 'research', icon: '🔍', label: 'Research',  desc: 'Web search, doc synthesis',      color: 'var(--accent)'  },
  { type: 'code',     icon: '⌨',  label: 'Code',      desc: 'Write, test, run code',          color: 'var(--green)'   },
  { type: 'data',     icon: '📊', label: 'Data',      desc: 'Analyze datasets, insights',     color: 'var(--violet)'  },
  { type: 'browser',  icon: '🌐', label: 'Browser',   desc: 'Web navigation, scraping',       color: 'var(--cyan)'    },
  { type: 'monitor',  icon: '👁',  label: 'Monitor',   desc: 'Watch events persistently',      color: 'var(--amber)'   },
  { type: 'download', icon: '⬇',  label: 'Download',  desc: 'Fetch files, models, datasets',  color: 'var(--magenta)' },
  { type: 'sync',     icon: '⎇',  label: 'Sync',      desc: 'Git sync operations',            color: 'var(--amber)'   },
];

const STATUS_COLOR = {
  running:  'var(--green)',
  complete: 'var(--accent)',
  error:    'var(--red)',
  killed:   'var(--muted)',
  timeout:  'var(--amber)',
};

// ─── Agent event listeners ────────────────────────────────────────────────────
function useAgentEvents() {
  const { upsertAgent, addStep, pushApproval, setResources } = useAgentStore();

  useEffect(() => {
    if (!isElectron) return;
    const unsubs = [
      window.rama.agents.onSpawned(a => upsertAgent(a)),
      window.rama.agents.onUpdate(a  => upsertAgent(a)),
      window.rama.agents.onStep(({ agentId, step }) => addStep(agentId, step)),
      window.rama.agents.onApprovalNeeded(item => pushApproval(item)),
    ];

    // Load initial resources
    window.rama.agents.getResources().then(res => {
      if (res.ok) setResources(res.data);
    });

    return () => unsubs.forEach(u => u?.());
  }, []);
}

// ─── Approval banner ─────────────────────────────────────────────────────────
function ApprovalBanner({ items, onResolve }) {
  if (items.length === 0) return null;
  return (
    <div style={{ background: 'rgba(255,170,0,0.1)', border: '1px solid rgba(255,170,0,0.4)',
      borderRadius: 'var(--radius)', padding: '12px 16px', marginBottom: '16px' }}>
      <div style={{ color: 'var(--amber)', fontWeight: 700, fontSize: '11px', marginBottom: '8px' }}>
        ⚠ AGENT ACTION REQUIRES YOUR APPROVAL ({items.length})
      </div>
      {items.map(item => (
        <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '6px 0', borderTop: '1px solid rgba(255,170,0,0.2)' }}>
          <span style={{ fontSize: '12px', color: 'var(--text)' }}>{item.description}</span>
          <div style={{ display: 'flex', gap: '6px' }}>
            <button className="btn btn-sm btn-primary" onClick={() => onResolve(item.id, true)}>Approve</button>
            <button className="btn btn-sm btn-danger"  onClick={() => onResolve(item.id, false)}>Deny</button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Agent card ───────────────────────────────────────────────────────────────
function AgentCard({ agent, onKill }) {
  const [expanded, setExpanded] = useState(false);
  const typeInfo = AGENT_TYPES.find(t => t.type === agent.type) || { icon: '◈', color: 'var(--muted)' };
  const elapsed  = ((Date.now() - agent.startedAt) / 1000).toFixed(0);

  return (
    <div className="hud-card" style={{ padding: '14px', marginBottom: '8px',
      borderColor: agent.status === 'running' ? typeInfo.color + '44' : 'var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <span style={{ fontSize: '16px' }}>{typeInfo.icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontWeight: 700, fontSize: '12px', color: typeInfo.color }}>{agent.label}</span>
            <span className="badge" style={{
              background: `${STATUS_COLOR[agent.status]}22`,
              color: STATUS_COLOR[agent.status],
              border: `1px solid ${STATUS_COLOR[agent.status]}44`,
              fontSize: '9px',
            }}>{agent.status.toUpperCase()}</span>
            <span style={{ fontSize: '10px', color: 'var(--muted)', marginLeft: 'auto' }}>{elapsed}s</span>
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text-dim)', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {agent.task}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
          <button className="btn btn-sm" onClick={() => setExpanded(e => !e)}>
            {expanded ? '▲' : '▼'}
          </button>
          {agent.status === 'running' && (
            <button className="btn btn-sm btn-danger" onClick={() => onKill(agent.id)}>Kill</button>
          )}
        </div>
      </div>

      {expanded && (
        <div style={{ marginTop: '12px', borderTop: '1px solid var(--border)', paddingTop: '12px' }}>
          {agent.result && (
            <div style={{ background: 'var(--surface)', borderRadius: 'var(--radius)', padding: '10px',
              fontSize: '12px', color: 'var(--text)', lineHeight: '1.7', whiteSpace: 'pre-wrap',
              maxHeight: '200px', overflowY: 'auto', marginBottom: '8px' }}>
              {agent.result}
            </div>
          )}
          {agent.error && (
            <div style={{ color: 'var(--red)', fontSize: '11px', marginBottom: '8px' }}>✕ {agent.error}</div>
          )}
          {agent.steps?.length > 0 && (
            <div>
              <div className="section-label" style={{ marginBottom: '6px' }}>STEPS</div>
              {agent.steps.map((s, i) => (
                <div key={i} style={{ fontSize: '10px', color: 'var(--muted)', padding: '2px 0',
                  borderLeft: '2px solid var(--border)', paddingLeft: '8px', marginBottom: '2px' }}>
                  <span style={{ color: 'var(--accent)' }}>{s.label}</span>
                  {' — '}
                  {typeof s.data === 'object' ? JSON.stringify(s.data) : s.data}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Spawn modal ──────────────────────────────────────────────────────────────
function SpawnModal({ onClose, onSpawn }) {
  const [type,    setType]    = useState('research');
  const [task,    setTask]    = useState('');
  const [context, setContext] = useState('');
  const [busy,    setBusy]    = useState(false);

  const spawn = async () => {
    if (!task.trim()) return;
    setBusy(true);
    await onSpawn({ type, task, config: { context } });
    setBusy(false);
    onClose();
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 500 }}>
      <div className="hud-card" style={{ width: '520px', padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontWeight: 700, color: 'var(--accent)', letterSpacing: '0.08em' }}>SPAWN AGENT</span>
          <button className="btn btn-sm" onClick={onClose}>✕</button>
        </div>

        <div>
          <div className="section-label" style={{ marginBottom: '8px' }}>AGENT TYPE</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px' }}>
            {AGENT_TYPES.map(at => (
              <button key={at.type} onClick={() => setType(at.type)} style={{
                padding: '8px 6px', border: `1px solid ${type === at.type ? at.color : 'var(--border)'}`,
                borderRadius: 'var(--radius)', background: type === at.type ? `${at.color}11` : 'transparent',
                color: type === at.type ? at.color : 'var(--muted)', cursor: 'pointer',
                fontFamily: 'var(--font)', fontSize: '11px', textAlign: 'center',
              }}>
                <div>{at.icon}</div>
                <div style={{ marginTop: '3px' }}>{at.label}</div>
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="section-label" style={{ marginBottom: '6px' }}>TASK</div>
          <textarea className="input" rows={3} placeholder="Describe what this agent should do..."
            value={task} onChange={e => setTask(e.target.value)} />
        </div>

        <div>
          <div className="section-label" style={{ marginBottom: '6px' }}>CONTEXT (optional)</div>
          <textarea className="input" rows={2} placeholder="Any additional context or data..."
            value={context} onChange={e => setContext(e.target.value)} />
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <button className="btn btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn btn-sm btn-primary" disabled={!task.trim() || busy} onClick={spawn}>
            {busy ? 'Spawning...' : '⚡ Spawn Agent'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Agents page ─────────────────────────────────────────────────────────
export default function Agents() {
  useAgentEvents();
  const { agents, approvalQueue, resolveApproval, resources } = useAgentStore();
  const [showSpawn, setShowSpawn] = useState(false);
  const [filter, setFilter]       = useState('all');

  const agentList = Object.values(agents);
  const filtered  = filter === 'all'
    ? agentList
    : agentList.filter(a => a.status === filter);

  const killAgent = useCallback(async (id) => {
    if (!isElectron) return;
    await window.rama.agents.kill(id);
  }, []);

  const killAll = useCallback(async () => {
    if (!isElectron) return;
    await window.rama.agents.killAll();
  }, []);

  const spawnAgent = useCallback(async (opts) => {
    if (!isElectron) return;
    await window.rama.agents.spawn(opts);
  }, []);

  const handleResolve = useCallback((id, approved) => {
    resolveApproval(id);
    // TODO Phase 5: send approval decision back to agent
  }, [resolveApproval]);

  const active = agentList.filter(a => a.status === 'running').length;

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {showSpawn && <SpawnModal onClose={() => setShowSpawn(false)} onSpawn={spawnAgent} />}

      {/* Header */}
      <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', background: 'var(--surface)',
        display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
        <span style={{ fontWeight: 700, color: 'var(--violet)', letterSpacing: '0.1em' }}>AGENT CONTROL</span>
        <span className="badge badge-violet">{active} ACTIVE</span>
        {resources && (
          <span style={{ fontSize: '10px', color: 'var(--muted)' }}>
            {active}/{resources.maxAgents} agents · {resources.ramFreeMB}MB free RAM
          </span>
        )}
        <div style={{ flex: 1 }} />
        {active > 0 && (
          <button className="btn btn-sm btn-danger" onClick={killAll}>Kill All</button>
        )}
        <button className="btn btn-sm btn-primary" onClick={() => setShowSpawn(true)}>⚡ Spawn Agent</button>
      </div>

      {/* Filter tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', background: 'var(--surface)', flexShrink: 0 }}>
        {['all', 'running', 'complete', 'error'].map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{
            padding: '8px 16px', border: 'none', background: 'transparent',
            color: filter === f ? 'var(--violet)' : 'var(--muted)',
            borderBottom: filter === f ? '2px solid var(--violet)' : '2px solid transparent',
            cursor: 'pointer', fontFamily: 'var(--font)', fontSize: '11px', textTransform: 'uppercase',
          }}>{f} ({agentList.filter(a => f === 'all' || a.status === f).length})</button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', minHeight: 0 }}>
        {/* Approvals */}
        <ApprovalBanner items={approvalQueue} onResolve={handleResolve} />

        {/* Resource governor */}
        {resources && (
          <div className="hud-card" style={{ padding: '12px 16px', marginBottom: '16px', display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
            <div style={{ fontSize: '10px', color: 'var(--muted)', letterSpacing: '0.1em', flex: '0 0 100%' }}>
              RESOURCE GOVERNOR
            </div>
            {[
              ['Max Agents',    `${active}/${resources.maxAgents}`],
              ['RAM Free',      `${resources.ramFreeMB}MB`],
              ['RAM Used',      `${resources.ramUsedPct}%`],
              ['CPU Cap',       `${resources.governor.TOTAL_CPU_CAP}%`],
              ['Timeout',       `${resources.governor.AGENT_TIMEOUT_MS / 1000}s`],
            ].map(([k, v]) => (
              <div key={k} style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '10px', color: 'var(--muted)' }}>{k}</div>
                <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--accent)' }}>{v}</div>
              </div>
            ))}
          </div>
        )}

        {/* Agent list */}
        {filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px', color: 'var(--muted)' }}>
            <div style={{ fontSize: '32px', marginBottom: '12px' }}>◈</div>
            <div style={{ fontSize: '12px' }}>No agents. Click "Spawn Agent" to create one.</div>
          </div>
        ) : (
          filtered.map(agent => (
            <AgentCard key={agent.id} agent={agent} onKill={killAgent} />
          ))
        )}
      </div>
    </div>
  );
}
