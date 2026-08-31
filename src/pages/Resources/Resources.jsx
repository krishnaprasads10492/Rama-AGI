import React, { useEffect, useState, useCallback } from 'react';
import { emitActivity } from '@components/ActivityStream.jsx';

const isElectron = typeof window !== 'undefined' && !!window.rama;

const PRESSURE_STYLES = {
  optimal:  { color: 'var(--green)',   label: 'OPTIMAL',  bg: 'rgba(0,255,65,0.08)'  },
  moderate: { color: 'var(--amber)',   label: 'MODERATE', bg: 'rgba(255,170,0,0.08)' },
  high:     { color: 'var(--red)',     label: 'HIGH',     bg: 'rgba(255,0,60,0.08)'  },
  critical: { color: 'var(--red)',     label: 'CRITICAL', bg: 'rgba(255,0,60,0.15)'  },
};

const PRIORITY_LABELS = ['CRITICAL', 'HIGH', 'NORMAL', 'LOW', 'BACKGROUND'];
const PRIORITY_COLORS = ['var(--red)', 'var(--magenta)', 'var(--accent)', 'var(--amber)', 'var(--muted)'];

// ─── Arc gauge ────────────────────────────────────────────────────────────────
function ArcGauge({ value, max = 100, color, label, sub, size = 90 }) {
  const pct  = Math.min(1, value / max);
  const r    = (size / 2) - 8;
  const circ = Math.PI * r;   // Half circle
  const c    = color || (pct > 0.85 ? 'var(--red)' : pct > 0.65 ? 'var(--amber)' : 'var(--accent)');
  const cx   = size / 2;
  const cy   = size / 2 + 8;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
      <div style={{ position: 'relative', width: size, height: size / 2 + 16, overflow: 'hidden' }}>
        <svg width={size} height={size} style={{ position: 'absolute', top: 0, left: 0 }}>
          {/* Track */}
          <path d={`M ${8} ${cy} A ${r} ${r} 0 0 1 ${size - 8} ${cy}`}
            fill="none" stroke="var(--border)" strokeWidth="6" strokeLinecap="round" />
          {/* Fill */}
          <path d={`M ${8} ${cy} A ${r} ${r} 0 0 1 ${size - 8} ${cy}`}
            fill="none" stroke={c} strokeWidth="6" strokeLinecap="round"
            strokeDasharray={`${pct * circ} ${circ}`}
            style={{ filter: `drop-shadow(0 0 4px ${c})`, transition: 'stroke-dasharray 0.6s ease' }} />
        </svg>
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0,
          display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <span style={{ fontSize: 18, fontWeight: 700, color: c, lineHeight: 1 }}>
            {typeof value === 'number' ? `${value}${max === 100 ? '%' : ''}` : value}
          </span>
        </div>
      </div>
      <span style={{ fontSize: 10, color: 'var(--text-dim)', letterSpacing: '0.08em' }}>{label}</span>
      {sub && <span style={{ fontSize: 9, color: 'var(--muted)' }}>{sub}</span>}
    </div>
  );
}

// ─── API rate limit bar ───────────────────────────────────────────────────────
function ApiLimitBar({ provider, data }) {
  const pct   = data.pct || 0;
  const color = pct > 90 ? 'var(--red)' : pct > 70 ? 'var(--amber)' : 'var(--green)';
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
        <span style={{ fontSize: 11, color: 'var(--text)', fontWeight: 600 }}>{provider}</span>
        <span style={{ fontSize: 11, color }}>
          {data.used}/{data.cap} req/min ({pct}%)
        </span>
      </div>
      <div style={{ height: 4, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: `${Math.min(100, pct)}%`, height: '100%', background: color,
          boxShadow: `0 0 4px ${color}88`, transition: 'width 0.5s ease' }} />
      </div>
    </div>
  );
}

// ─── Task row ─────────────────────────────────────────────────────────────────
function TaskRow({ task, onCancel }) {
  const priorityColor = PRIORITY_COLORS[task.priority ?? 2] || 'var(--muted)';
  const statusColor = {
    queued:   'var(--muted)',
    running:  'var(--accent)',
    complete: 'var(--green)',
    failed:   'var(--red)',
  }[task.status] || 'var(--muted)';

  const elapsed = task.startedAt ? Math.round((Date.now() - task.startedAt) / 1000) : null;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 14px',
      borderBottom: '1px solid var(--border)' }}>
      <div style={{ width: 6, height: 6, borderRadius: '50%', background: statusColor,
        boxShadow: task.status === 'running' ? `0 0 6px ${statusColor}` : 'none',
        animation: task.status === 'running' ? 'pulse-ring 1.2s ease infinite' : 'none',
        flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {task.type}{task.description ? ` — ${task.description}` : ''}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
          <span style={{ fontSize: 9, color: priorityColor, fontWeight: 700, textTransform: 'uppercase' }}>
            {PRIORITY_LABELS[task.priority ?? 2]}
          </span>
          {task.aiProvider && (
            <span style={{ fontSize: 9, color: 'var(--muted)' }}>{task.aiProvider}</span>
          )}
          {elapsed !== null && (
            <span style={{ fontSize: 9, color: 'var(--muted)' }}>{elapsed}s</span>
          )}
        </div>
      </div>
      {task.status === 'queued' && onCancel && (
        <button className="btn btn-sm" style={{ fontSize: 9, padding: '2px 6px' }}
          onClick={() => onCancel(task.id)}>✕</button>
      )}
    </div>
  );
}

// ─── Submit task panel ────────────────────────────────────────────────────────
function SubmitTaskPanel({ onSubmit }) {
  const [type,        setType]        = useState('ai-chat');
  const [description, setDescription] = useState('');
  const [priority,    setPriority]    = useState(2);
  const [provider,    setProvider]    = useState('');

  const TASK_TYPES = [
    'ai-chat', 'web-search', 'file-scan', 'git-sync',
    'agent-spawn', 'browser-fetch', 'data-analysis', 'evolution-scout',
  ];

  return (
    <div className="hud-card" style={{ padding: 16 }}>
      <div className="section-label" style={{ marginBottom: 10 }}>SUBMIT TASK TO ORCHESTRATOR</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 4 }}>TYPE</div>
            <select value={type} onChange={e => setType(e.target.value)}
              style={{ width: '100%', background: 'var(--elevated)', border: '1px solid var(--border)',
                color: 'var(--text)', fontFamily: 'var(--font)', fontSize: 11, padding: '6px 8px',
                borderRadius: 'var(--radius)', outline: 'none' }}>
              {TASK_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 4 }}>PRIORITY</div>
            <select value={priority} onChange={e => setPriority(parseInt(e.target.value))}
              style={{ width: '100%', background: 'var(--elevated)', border: '1px solid var(--border)',
                color: PRIORITY_COLORS[priority], fontFamily: 'var(--font)', fontSize: 11,
                padding: '6px 8px', borderRadius: 'var(--radius)', outline: 'none' }}>
              {PRIORITY_LABELS.map((l, i) => <option key={i} value={i}>{l}</option>)}
            </select>
          </div>
        </div>

        <input className="input" value={description} onChange={e => setDescription(e.target.value)}
          placeholder="Task description..." style={{ fontSize: 11 }} />

        <input className="input" value={provider} onChange={e => setProvider(e.target.value)}
          placeholder="AI provider (optional: openai, anthropic, groq, ollama...)" style={{ fontSize: 11 }} />

        <button className="btn btn-primary btn-sm" style={{ alignSelf: 'flex-end' }}
          onClick={() => { onSubmit({ type, description, priority, aiProvider: provider || undefined }); setDescription(''); }}>
          ⚡ Submit Task
        </button>
      </div>
    </div>
  );
}

// ─── Resource research tab ─────────────────────────────────────────────────────
const STATUS_STYLES = {
  enabled:              { color: 'var(--green)',  label: 'ENABLED' },
  'wired-no-key':       { color: 'var(--amber)',  label: 'WIRED — NO KEY' },
  'wired-vault-locked': { color: 'var(--amber)',  label: 'WIRED — VAULT LOCKED' },
  'keyed-not-wired':    { color: 'var(--amber)',  label: 'KEY SET — NOT WIRED' },
  // 'no-key-needed' was removed: it was emitted for resources that need no
  // credential *and are not wired*, and rendered as a green "READY" — claiming
  // adoption that had not happened. Those now report 'researched-only'. Unknown
  // statuses already fall back to that below, so nothing needs a style here.
  'researched-only':    { color: 'var(--muted)',  label: 'NOT ENABLED' },
};

function ResourceRow({ resource, onResearch, researching }) {
  const st = STATUS_STYLES[resource.status] || STATUS_STYLES['researched-only'];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px',
      borderBottom: '1px solid var(--border)' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, color: 'var(--text)', fontWeight: 600 }}>{resource.name}</div>
        <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>{resource.notes}</div>
      </div>
      <div style={{ padding: '2px 8px', background: `${st.color}18`, border: `1px solid ${st.color}44`,
        borderRadius: 2, fontSize: 9, fontWeight: 700, color: st.color, letterSpacing: '0.05em', flexShrink: 0 }}>
        {st.label}
      </div>
      <button className="btn btn-sm" style={{ fontSize: 10, flexShrink: 0 }}
        disabled={researching}
        onClick={() => onResearch(resource)}>
        {researching ? '…' : '🔎 Research'}
      </button>
    </div>
  );
}

function ResourceReportPanel({ report }) {
  if (!report) return null;
  if (!report.ok) {
    return (
      <div className="hud-card" style={{ padding: 16, borderColor: 'var(--red)' }}>
        <div style={{ fontSize: 12, color: 'var(--red)', fontWeight: 700, marginBottom: 6 }}>
          Could not read docs: {report.reason}
        </div>
        {report.hint && <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>{report.hint}</div>}
      </div>
    );
  }
  const s = report.signals || {};
  return (
    <div className="hud-card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="section-label">RESEARCH REPORT — {report.url}</div>
      {s.pricesFound?.length > 0 && (
        <div><span style={{ fontSize: 10, color: 'var(--muted)' }}>PRICES FOUND: </span>
          <span style={{ fontSize: 11, color: 'var(--text)' }}>{s.pricesFound.join(', ')}</span></div>
      )}
      {s.rateLimitsFound?.length > 0 && (
        <div><span style={{ fontSize: 10, color: 'var(--muted)' }}>RATE LIMITS: </span>
          <span style={{ fontSize: 11, color: 'var(--text)' }}>{s.rateLimitsFound.join(', ')}</span></div>
      )}
      {s.freeTierMentions?.length > 0 && (
        <div>
          <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 3 }}>FREE TIER MENTIONS</div>
          {s.freeTierMentions.map((m, i) => (
            <div key={i} style={{ fontSize: 10, color: 'var(--text-dim)', padding: '3px 0' }}>… {m} …</div>
          ))}
        </div>
      )}
      {s.apiKeyMentions?.length > 0 && (
        <div>
          <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 3 }}>CREDENTIAL / AUTH MENTIONS</div>
          {s.apiKeyMentions.map((m, i) => (
            <div key={i} style={{ fontSize: 10, color: 'var(--text-dim)', padding: '3px 0' }}>… {m} …</div>
          ))}
        </div>
      )}
      <div style={{ fontSize: 10, color: 'var(--muted)', fontStyle: 'italic' }}>{report.disclaimer}</div>
    </div>
  );
}

function ResearchTab() {
  const [catalog, setCatalog] = useState(null);
  const [customUrl, setCustomUrl] = useState('');
  const [researching, setResearching] = useState(null);
  const [report, setReport] = useState(null);

  const load = useCallback(async () => {
    if (!isElectron) return;
    const res = await window.rama?.resourceResearch?.catalog?.();
    if (res?.ok) setCatalog(res.data);
  }, []);

  useEffect(() => { load(); }, [load]);

  const runResearch = async (resource) => {
    if (!isElectron) { emitActivity('action', `[Demo] Research ${resource?.name || customUrl}`); return; }
    setResearching(resource?.id || 'custom');
    setReport(null);
    const opts = resource ? { resourceId: resource.id } : { url: customUrl };
    const res = await window.rama?.resourceResearch?.research?.(opts);
    setResearching(null);
    if (res?.ok) {
      setReport(res.data);
      emitActivity('action', `Researched ${resource?.name || customUrl}`);
    } else {
      setReport({ ok: false, reason: res?.error || 'Unknown error' });
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 760 }}>
      <div className="hud-card" style={{ padding: 16 }}>
        <div className="section-label" style={{ marginBottom: 10 }}>RESEARCH AN ARBITRARY URL</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input className="input" value={customUrl} onChange={e => setCustomUrl(e.target.value)}
            placeholder="https://provider.com/pricing" style={{ flex: 1, fontSize: 11 }} />
          <button className="btn btn-primary btn-sm" disabled={!customUrl || researching}
            onClick={() => runResearch(null)}>
            {researching === 'custom' ? '…' : 'Read Docs'}
          </button>
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 8, lineHeight: 1.6 }}>
          Rāma fetches the page live and extracts pricing, rate limits, and credential
          requirements — it never answers this from training data alone.
        </div>
      </div>

      {catalog && Object.entries(catalog.axes || {}).map(([axisId, axis]) => (
        <div key={axisId} className="hud-card" style={{ overflow: 'hidden' }}>
          <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)',
            fontSize: 10, color: 'var(--muted)', fontWeight: 700, letterSpacing: '0.1em' }}>
            {axis.label?.toUpperCase()}
          </div>
          {(axis.resources || []).map(r => (
            <ResourceRow key={r.id} resource={r} researching={researching === r.id}
              onResearch={runResearch} />
          ))}
        </div>
      ))}

      <ResourceReportPanel report={report} />

      <div style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.7, padding: '10px 14px',
        background: 'var(--elevated)', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
        <span style={{ color: 'var(--accent)', fontWeight: 700 }}>How enabling works:</span>{' '}
        Research never writes anything. Turning a finding into a real integration goes through
        the same proposal ledger every self-change uses (Proposals page) — master reviews the
        exact wiring diff before it's applied, and any credential is entered directly into the
        vault afterward, never stored in the proposal itself.
      </div>
    </div>
  );
}

// ─── Main Resources page ──────────────────────────────────────────────────────
export default function Resources() {
  const [status,  setStatus]  = useState(null);
  const [tab,     setTab]     = useState('overview');
  const [events,  setEvents]  = useState([]);

  const load = useCallback(async () => {
    if (!isElectron) {
      // Mock data for browser dev
      setStatus({
        snapshot:  { cpu: 42, ram: 58, temp: 55, pressure: 'moderate', ramFreeMB: 4200 },
        workers:   { current: 2, max: 4 },
        queue:     { queued: 3, running: 2, byPriority: { CRITICAL: 0, HIGH: 1, NORMAL: 2, LOW: 0, BACKGROUND: 0 }, history: [] },
        apiLimits: {
          openai:    { used: 12, cap: 400, pct: 3 },
          anthropic: { used: 2, cap: 48, pct: 4 },
          groq:      { used: 8, cap: 24, pct: 33 },
          ollama:    { used: 0, cap: 9999, pct: 0 },
        },
        running: [
          { id: 'abc1', type: 'ai-chat',    priority: 1, status: 'running', startedAt: Date.now() - 2000, aiProvider: 'openai' },
          { id: 'abc2', type: 'web-search', priority: 2, status: 'running', startedAt: Date.now() - 800 },
        ],
        thresholds: { CPU: { OPTIMAL: 50, MODERATE: 70, HIGH: 85, CRITICAL: 95 } },
      });
      return;
    }
    const res = await window.ipcRenderer?.invoke('orchestrator:status');
    if (res?.ok) setStatus(res.data);
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 2000);

    if (!isElectron) return () => clearInterval(id);
    // Listen for orchestrator events
    const channels = [
      'orchestrator:task-queued', 'orchestrator:task-started',
      'orchestrator:task-complete', 'orchestrator:task-failed',
      'orchestrator:resource-update', 'orchestrator:workers-adapted',
    ];
    const handlers = channels.map(ch => {
      const h = (_e, d) => {
        setEvents(s => [{ channel: ch, data: d, ts: Date.now() }, ...s].slice(0, 50));
      };
      window.ipcRenderer?.on(ch, h);
      return { ch, h };
    });

    return () => {
      clearInterval(id);
      handlers.forEach(({ ch, h }) => window.ipcRenderer?.removeListener(ch, h));
    };
  }, [load]);

  const submitTask = async (task) => {
    if (!isElectron) {
      emitActivity('action', `[Demo] Submit task: ${task.type} (${PRIORITY_LABELS[task.priority]})`);
      return;
    }
    const res = await window.ipcRenderer?.invoke('orchestrator:submit', task);
    if (res?.ok) { emitActivity('action', `Task submitted: ${task.type} — id ${res.id}`); load(); }
  };

  const cancelTask = async (id) => {
    if (!isElectron) return;
    await window.ipcRenderer?.invoke('orchestrator:cancel', id);
    load();
  };

  const s   = status;
  const pst = s ? (PRESSURE_STYLES[s.snapshot.pressure] || PRESSURE_STYLES.optimal) : PRESSURE_STYLES.optimal;

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)',
        background: s ? pst.bg : 'var(--surface)',
        display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0,
        transition: 'background 0.5s ease' }}>
        <span style={{ fontSize: 18 }}>⬢</span>
        <div>
          <div style={{ fontWeight: 700, color: pst.color, letterSpacing: '0.1em' }}>
            RESOURCE ORCHESTRATOR
          </div>
          <div style={{ fontSize: 10, color: 'var(--muted)' }}>
            Dynamic multi-resource scheduling · {s?.workers?.current ?? 0}/{s?.workers?.max ?? 0} workers active
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ padding: '3px 12px', background: `${pst.color}18`, border: `1px solid ${pst.color}44`,
          borderRadius: 2, fontSize: 11, fontWeight: 700, color: pst.color, letterSpacing: '0.1em' }}>
          {pst.label}
        </div>
        <button className="btn btn-sm" onClick={load}>↺</button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', background: 'var(--surface)', flexShrink: 0 }}>
        {['overview', 'queue', 'api-limits', 'research', 'events', 'configure'].map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: '9px 14px', border: 'none', background: 'transparent',
            color: tab === t ? 'var(--accent)' : 'var(--muted)',
            borderBottom: tab === t ? '2px solid var(--accent)' : '2px solid transparent',
            cursor: 'pointer', fontFamily: 'var(--font)', fontSize: '11px', textTransform: 'uppercase',
          }}>{t}</button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 20, minHeight: 0 }}>

        {/* ── Overview ── */}
        {tab === 'overview' && s && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Gauges */}
            <div className="hud-card" style={{ padding: 20 }}>
              <div className="section-label" style={{ marginBottom: 16 }}>LIVE RESOURCE SNAPSHOT</div>
              <div style={{ display: 'flex', justifyContent: 'space-around', flexWrap: 'wrap', gap: 16 }}>
                <ArcGauge value={s.snapshot.cpu}  label="CPU"  sub={`${s.snapshot.temp}°C`} />
                <ArcGauge value={s.snapshot.ram}  label="RAM"  sub={`${s.snapshot.ramFreeMB}MB free`} />
                <ArcGauge value={s.workers.current} max={s.workers.max || 1}
                  label="WORKERS" sub={`${s.workers.current}/${s.workers.max}`}
                  color="var(--violet)" />
                <ArcGauge value={s.queue.queued} max={Math.max(10, s.queue.queued)}
                  label="QUEUED" sub={`${s.queue.running} running`}
                  color="var(--amber)" />
              </div>
            </div>

            {/* Priority breakdown */}
            <div className="hud-card" style={{ padding: 16 }}>
              <div className="section-label" style={{ marginBottom: 12 }}>TASK QUEUE BY PRIORITY</div>
              <div style={{ display: 'flex', gap: 8 }}>
                {Object.entries(s.queue.byPriority || {}).map(([label, count], i) => (
                  <div key={label} style={{ flex: 1, textAlign: 'center', padding: '8px 4px',
                    background: count > 0 ? `${PRIORITY_COLORS[i]}15` : 'var(--surface)',
                    border: `1px solid ${count > 0 ? PRIORITY_COLORS[i] + '44' : 'var(--border)'}`,
                    borderRadius: 'var(--radius)' }}>
                    <div style={{ fontSize: 20, fontWeight: 700, color: PRIORITY_COLORS[i] }}>{count}</div>
                    <div style={{ fontSize: 9, color: 'var(--muted)', marginTop: 3 }}>{label}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Adaptive worker note */}
            <div style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.7, padding: '10px 14px',
              background: 'var(--elevated)', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
              <span style={{ color: 'var(--accent)', fontWeight: 700 }}>Adaptive workers:</span>{' '}
              {/* `os.cpus()` used to be called here. `os` is a Node builtin and does not exist in
                  the renderer, so this threw `ReferenceError: os is not defined` the moment the
                  first orchestrator:status response arrived — killing the default tab and with it
                  the page. The worker ceiling is already computed by the orchestrator from the
                  real CPU count, so read the reported value instead of recomputing it in the
                  renderer, where the input is not available. See spec Section 81. */}
              When CPU pressure is <span style={{ color: 'var(--green)' }}>optimal</span> → {s.workers?.max ?? '—'} workers.{' '}
              <span style={{ color: 'var(--amber)' }}>moderate</span> → reduces.{' '}
              <span style={{ color: 'var(--red)' }}>critical</span> → 1 worker (only CRITICAL priority tasks run).
              Under pressure, Rāma auto-routes AI tasks to local Ollama models to save API quota.
            </div>
          </div>
        )}

        {/* ── Task queue ── */}
        {tab === 'queue' && s && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 700 }}>
            <SubmitTaskPanel onSubmit={submitTask} />

            {/* Running */}
            {s.running?.length > 0 && (
              <div className="hud-card" style={{ overflow: 'hidden' }}>
                <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)',
                  fontSize: 10, color: 'var(--muted)', fontWeight: 700, letterSpacing: '0.1em' }}>
                  RUNNING ({s.running.length})
                </div>
                {s.running.map(t => <TaskRow key={t.id} task={t} />)}
              </div>
            )}

            {/* Recent history */}
            {s.queue?.history?.length > 0 && (
              <div className="hud-card" style={{ overflow: 'hidden' }}>
                <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)',
                  fontSize: 10, color: 'var(--muted)', fontWeight: 700, letterSpacing: '0.1em' }}>
                  RECENT
                </div>
                {s.queue.history.map((t, i) => <TaskRow key={i} task={t} />)}
              </div>
            )}
          </div>
        )}

        {/* ── API limits ── */}
        {tab === 'api-limits' && s && (
          <div style={{ maxWidth: 560 }}>
            <div className="hud-card" style={{ padding: 16, marginBottom: 16 }}>
              <div className="section-label" style={{ marginBottom: 14 }}>API RATE LIMIT USAGE (per minute)</div>
              {Object.entries(s.apiLimits || {}).map(([provider, data]) => (
                <ApiLimitBar key={provider} provider={provider} data={data} />
              ))}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.7, padding: '10px 14px',
              background: 'var(--elevated)', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
              <span style={{ color: 'var(--accent)', fontWeight: 700 }}>Cost optimization:</span>{' '}
              Rāma uses only 80% of each provider's limit as a safety buffer. When a provider
              nears capacity, tasks are automatically rerouted to the next available provider
              or to local Ollama models (zero API cost). Rate limits reset every 60 seconds.
            </div>
          </div>
        )}

        {/* ── Research ── */}
        {tab === 'research' && <ResearchTab />}

        {/* ── Events ── */}
        {tab === 'events' && (
          <div className="hud-card" style={{ overflow: 'hidden' }}>
            <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)',
              fontSize: 10, color: 'var(--muted)', fontWeight: 700, letterSpacing: '0.1em' }}>
              ORCHESTRATOR EVENTS (live)
            </div>
            {events.length === 0 ? (
              <div style={{ padding: 20, color: 'var(--muted)', textAlign: 'center', fontSize: 12 }}>
                No events yet — events appear in real time as tasks run.
              </div>
            ) : events.map((e, i) => (
              <div key={i} style={{ padding: '5px 14px', borderBottom: '1px solid var(--border)',
                display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 9, color: 'var(--muted)', flexShrink: 0, minWidth: 80 }}>
                  {new Date(e.ts).toLocaleTimeString()}
                </span>
                <span style={{ fontSize: 11, color: 'var(--accent)', flexShrink: 0 }}>
                  {e.channel.replace('orchestrator:', '')}
                </span>
                <span style={{ fontSize: 10, color: 'var(--text-dim)', overflow: 'hidden',
                  textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {JSON.stringify(e.data).slice(0, 80)}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* ── Configure ── */}
        {tab === 'configure' && s && (
          <ConfigurePanel thresholds={s.thresholds} workers={s.workers} onSave={async (limits) => {
            if (!isElectron) return;
            await window.ipcRenderer?.invoke('orchestrator:set-limits', limits);
            load();
          }} />
        )}
      </div>
    </div>
  );
}

function ConfigurePanel({ thresholds, workers, onSave }) {
  const [cpuHigh,     setCpuHigh]     = useState(thresholds?.CPU?.HIGH     || 85);
  const [cpuCritical, setCpuCritical] = useState(thresholds?.CPU?.CRITICAL || 95);
  const [ramCritical, setRamCritical] = useState(thresholds?.RAM?.CRITICAL || 92);
  const [maxWorkers,  setMaxWorkers]  = useState(workers?.max || 4);

  return (
    <div className="hud-card" style={{ padding: 20, maxWidth: 480 }}>
      <div className="section-label" style={{ marginBottom: 16 }}>RESOURCE LIMITS (Master Override)</div>
      {[
        { label: 'CPU HIGH threshold (%)',      value: cpuHigh,     set: setCpuHigh,     min: 50, max: 90 },
        { label: 'CPU CRITICAL threshold (%)',  value: cpuCritical, set: setCpuCritical, min: 70, max: 99 },
        { label: 'RAM CRITICAL threshold (%)',  value: ramCritical, set: setRamCritical, min: 70, max: 99 },
        { label: 'Max parallel workers',        value: maxWorkers,  set: setMaxWorkers,  min: 1,  max: 16 },
      ].map(f => (
        <div key={f.label} style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
            <span style={{ fontSize: 11, color: 'var(--text)' }}>{f.label}</span>
            <span style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 700 }}>{f.value}</span>
          </div>
          <input type="range" min={f.min} max={f.max} value={f.value}
            onChange={e => f.set(parseInt(e.target.value))}
            style={{ width: '100%', accentColor: 'var(--accent)' }} />
        </div>
      ))}
      <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }}
        onClick={() => onSave({ cpu: { high: cpuHigh, critical: cpuCritical },
          ram: { critical: ramCritical }, maxWorkers })}>
        Save Limits
      </button>
    </div>
  );
}
