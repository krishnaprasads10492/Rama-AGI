import React, { useEffect, useState, useCallback } from 'react';

const isElectron = typeof window !== 'undefined' && !!window.rama;

// Real-time metric polling
function useMetrics() {
  const [metrics, setMetrics] = useState({ cpu: 0, ram: 0 });

  useEffect(() => {
    let active = true;

    const poll = async () => {
      if (!isElectron) return;
      try {
        const res = await window.rama.system.getMetrics();
        if (active && res.ok) {
          setMetrics({ cpu: res.data.cpu.usage, ram: res.data.ram.usedPct });
        }
      } catch { /* ignore */ }
    };

    poll();
    const id = setInterval(poll, 3000);
    return () => { active = false; clearInterval(id); };
  }, []);

  return metrics;
}

function Clock() {
  const [time, setTime] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <span style={{ color: 'var(--text-dim)', fontSize: '11px', letterSpacing: '0.05em' }}>
      {time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
    </span>
  );
}

function MetricPill({ label, value, warn = 70, danger = 90 }) {
  const color = value >= danger ? 'var(--red)' : value >= warn ? 'var(--amber)' : 'var(--accent)';
  return (
    <div className="metric-pill no-drag" style={{ borderColor: color + '44' }}>
      <span style={{ color: 'var(--muted)', fontSize: '10px' }}>{label}</span>
      <span style={{ color, fontWeight: 700, minWidth: '28px', textAlign: 'right' }}>
        {value}%
      </span>
    </div>
  );
}

export default function Titlebar() {
  const { cpu, ram }   = useMetrics();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!isElectron) return;
    setMaximized(window.rama.window.isMaximized());
    const unsub = window.rama.window.onMaximized((val) => setMaximized(val));
    return unsub;
  }, []);

  const minimize = useCallback(() => isElectron && window.rama.window.minimize(), []);
  const maximize = useCallback(() => isElectron && window.rama.window.maximize(), []);
  const close    = useCallback(() => isElectron && window.rama.window.close(), []);

  return (
    <div style={{
      height:         'var(--titlebar-h)',
      background:     'var(--surface)',
      borderBottom:   '1px solid var(--border)',
      display:        'flex',
      alignItems:     'center',
      justifyContent: 'space-between',
      padding:        '0 0 0 12px',
      flexShrink:     0,
      WebkitAppRegion: 'drag',
      zIndex:         1000,
      position:       'relative',
    }}>
      {/* Left — Rāma identity */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        {/* Rāma online dot */}
        <div style={{ position: 'relative', width: '8px', height: '8px' }}>
          <div style={{
            width:        '8px',
            height:       '8px',
            borderRadius: '50%',
            background:   'var(--violet)',
            boxShadow:    'var(--glow-violet)',
          }} />
          <div style={{
            position:     'absolute',
            inset:        '-3px',
            borderRadius: '50%',
            border:       '1px solid var(--violet)',
            opacity:      0.4,
            animation:    'pulse-ring 2s ease infinite',
          }} />
        </div>

        <span style={{
          fontSize:      '12px',
          fontWeight:    700,
          color:         'var(--violet)',
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
        }}>
          RĀMA AGI
        </span>

        <span style={{
          fontSize:  '10px',
          color:     'var(--muted)',
          letterSpacing: '0.06em',
        }}>
          Supreme Benevolent AGI
        </span>
      </div>

      {/* Center — metrics */}
      <div style={{
        display:        'flex',
        alignItems:     'center',
        gap:            '8px',
        WebkitAppRegion: 'no-drag',
      }}>
        <MetricPill label="CPU" value={cpu} />
        <MetricPill label="RAM" value={ram} />
        <Clock />
      </div>

      {/* Right — window controls */}
      <div style={{
        display:        'flex',
        alignItems:     'center',
        WebkitAppRegion: 'no-drag',
        height:         '100%',
      }}>
        <TitleBtn onClick={minimize} label="─" title="Minimize" color="var(--text-dim)" hoverColor="var(--amber)" />
        <TitleBtn onClick={maximize} label={maximized ? '❐' : '□'} title={maximized ? 'Restore' : 'Maximize'} color="var(--text-dim)" hoverColor="var(--accent)" />
        <TitleBtn onClick={close}    label="✕" title="Close" color="var(--text-dim)" hoverColor="var(--red)" isClose />
      </div>
    </div>
  );
}

function TitleBtn({ onClick, label, title, color, hoverColor, isClose }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      title={title}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width:      '46px',
        height:     'var(--titlebar-h)',
        border:     'none',
        background: hover
          ? isClose
            ? 'rgba(255,0,60,0.15)'
            : 'rgba(0,255,255,0.06)'
          : 'transparent',
        color:      hover ? hoverColor : color,
        cursor:     'pointer',
        fontSize:   '13px',
        display:    'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'all 0.15s',
        WebkitAppRegion: 'no-drag',
      }}
    >
      {label}
    </button>
  );
}
