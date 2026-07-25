import React, { useEffect, useState } from 'react';
import { useNavigate }     from 'react-router-dom';
import { systemClient }    from '@services/ipcClient.js';
import { formatBytes, formatUptime } from '@services/ramaClient.js';
import RamaOrb from '@components/RamaOrb.jsx';

const MODULES = [
  { route: '/',          icon: '◈', label: 'Chat',       desc: 'AGI conversation — no limits',        color: 'var(--violet)'  },
  { route: '/system',    icon: '⬢', label: 'System',     desc: 'OS metrics, cleaner, processes',      color: 'var(--green)'   },
  { route: '/terminal',  icon: '>_',label: 'Terminal',   desc: 'Real PTY embedded shell',             color: 'var(--green)'   },
  { route: '/git',       icon: '⎇', label: 'Git Sync',   desc: 'Auto-sync repos across machines',     color: 'var(--amber)'   },
  { route: '/stockmind', icon: '◬', label: 'StockMind',  desc: 'AI stock predictions — 10 algorithms',color: 'var(--magenta)' },
  { route: '/knowledge', icon: '◉', label: 'Knowledge',  desc: 'Rāma\'s persistent memory store',    color: 'var(--accent)'  },
];

function StatCard({ label, value, unit, color }) {
  return (
    <div className="hud-card" style={{ padding: '14px 16px', flex: 1 }}>
      <div style={{ fontSize: '10px', color: 'var(--muted)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
        {label}
      </div>
      <div style={{ fontSize: '22px', fontWeight: 700, color, marginTop: '4px' }}>
        {value}
        {unit && <span style={{ fontSize: '12px', color: 'var(--text-dim)', marginLeft: '4px' }}>{unit}</span>}
      </div>
    </div>
  );
}

function ModuleCard({ mod, onClick }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="hud-card"
      style={{
        padding:    '18px',
        cursor:     'pointer',
        transition: 'all var(--transition)',
        borderColor: hover ? mod.color + '66' : 'var(--border)',
        boxShadow:  hover ? `0 0 20px ${mod.color}22` : 'none',
        transform:  hover ? 'translateY(-2px)' : 'none',
      }}
    >
      <div style={{ fontSize: '22px', marginBottom: '10px', filter: hover ? `drop-shadow(0 0 6px ${mod.color})` : 'none', transition: 'filter var(--transition)' }}>
        {mod.icon}
      </div>
      <div style={{ fontSize: '13px', fontWeight: 700, color: hover ? mod.color : 'var(--text)', marginBottom: '4px', transition: 'color var(--transition)' }}>
        {mod.label}
      </div>
      <div style={{ fontSize: '11px', color: 'var(--text-dim)', lineHeight: '1.5' }}>
        {mod.desc}
      </div>
    </div>
  );
}

export default function Home() {
  const navigate = useNavigate();
  const [metrics, setMetrics] = useState(null);

  useEffect(() => {
    systemClient.getMetrics().then(res => {
      if (res.ok) setMetrics(res.data);
    });
  }, []);

  return (
    <div style={{ padding: '24px', overflowY: 'auto', height: '100%' }}>
      {/* Hero */}
      <div style={{
        display:        'flex',
        alignItems:     'center',
        gap:            '20px',
        marginBottom:   '28px',
        padding:        '24px',
        background:     'var(--elevated)',
        border:         '1px solid var(--border)',
        borderRadius:   'var(--radius-lg)',
        position:       'relative',
        overflow:       'hidden',
      }}>
        {/* Background glow */}
        <div style={{
          position: 'absolute', right: '-60px', top: '-60px',
          width: '200px', height: '200px', borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(119,0,255,0.15), transparent 70%)',
          pointerEvents: 'none',
        }} />
        <RamaOrb size={60} />
        <div>
          <div style={{ fontSize: '22px', fontWeight: 700, color: 'var(--violet)', letterSpacing: '0.12em' }}>
            RĀMA AGI
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-dim)', marginTop: '4px' }}>
            Righteous Autonomous Master Agent — Supreme Desktop Intelligence
          </div>
          <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
            <span className="badge badge-violet">ONLINE</span>
            <span className="badge badge-cyan">v1.0.0</span>
            <span className="badge badge-green">BENEVOLENT</span>
          </div>
        </div>
      </div>

      {/* System snapshot */}
      {metrics && (
        <div style={{ display: 'flex', gap: '12px', marginBottom: '24px' }}>
          <StatCard label="CPU Usage"  value={metrics.cpu.usage}  unit="%" color={metrics.cpu.usage > 80 ? 'var(--red)' : 'var(--accent)'} />
          <StatCard label="RAM Used"   value={metrics.ram.usedPct} unit="%" color={metrics.ram.usedPct > 80 ? 'var(--red)' : 'var(--green)'} />
          <StatCard label="Uptime"     value={formatUptime(metrics.os.uptime)} color="var(--text-dim)" />
          <StatCard label="Platform"   value={metrics.os.platform.toUpperCase()} color="var(--amber)" />
        </div>
      )}

      {/* Module grid */}
      <div style={{ marginBottom: '16px' }}>
        <div className="section-label">MODULES</div>
      </div>
      <div style={{
        display:             'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
        gap:                 '12px',
      }}>
        {MODULES.map(mod => (
          <ModuleCard key={mod.route} mod={mod} onClick={() => navigate(mod.route)} />
        ))}
      </div>
    </div>
  );
}
