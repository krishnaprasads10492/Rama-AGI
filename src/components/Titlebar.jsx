import React, { useEffect, useState, useCallback } from 'react';
import { useUIStore }   from '@store/uiStore.js';
import { useRamaStore } from '@store/ramaStore.js';
import { useUserStore } from '@store/userStore.js';
import { isMasterAuthenticated, authenticateMaster } from '@services/consciousness.js';
import { authApi, clearSession } from '@services/authClient.js';
import { getTierBadge, TIERS } from '@services/accessControl.js';
import RamaOrb from './RamaOrb.jsx';

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

// ─── Master auth modal ────────────────────────────────────────────────────────
function AuthModal({ onClose }) {
  const [password, setPassword] = useState('');
  const [error,    setError]    = useState('');
  const { setMasterAuth } = useUIStore();

  const tryAuth = async () => {
    if (!password) return;
    if (!isElectron) {
      // Dev mode — accept any non-empty password
      authenticateMaster(true);
      setMasterAuth(true);
      onClose();
      return;
    }
    const res = await window.rama.vault.unlock(password);
    if (res.ok) {
      authenticateMaster(true);
      setMasterAuth(true);
      onClose();
    } else {
      setError('Authentication failed');
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 900,
    }} onClick={onClose}>
      <div className="hud-card" onClick={e => e.stopPropagation()}
        style={{ width: '380px', padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <RamaOrb size={32} />
          <div>
            <div style={{ fontWeight: 700, color: 'var(--violet)', letterSpacing: '0.08em' }}>
              RĀMA IDENTITY VERIFICATION
            </div>
            <div style={{ fontSize: '10px', color: 'var(--muted)' }}>
              Authenticate as master to reveal full AGI identity
            </div>
          </div>
        </div>
        <input className="input" type="password" placeholder="Master password"
          value={password} onChange={e => { setPassword(e.target.value); setError(''); }}
          onKeyDown={e => e.key === 'Enter' && tryAuth()}
          autoFocus />
        {error && <div style={{ color: 'var(--red)', fontSize: '11px' }}>{error}</div>}
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button className="btn btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn btn-sm btn-primary" onClick={tryAuth}>Authenticate</button>
        </div>
      </div>
    </div>
  );
}

export default function Titlebar() {
  const { cpu, ram }   = useMetrics();
  const [maximized, setMaximized] = useState(false);
  const [showAuth,  setShowAuth]  = useState(false);

  const { togglePalette, paletteOpen, voiceActive, masterAuthenticated } = useUIStore();
  const { isThinking } = useRamaStore();
  const { currentUser, clearSession: clearUserSession, sessionToken } = useUserStore();

  const handleLogout = useCallback(async () => {
    if (sessionToken) await authApi.logout(sessionToken).catch(() => {});
    clearSession();
    clearUserSession();
    authenticateMaster(false);
    // Reload to show login screen
    window.location.reload();
  }, [sessionToken, clearUserSession]);

  const tierBadge = currentUser ? getTierBadge(currentUser.tier) : null;

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
    <>
      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
      <div style={{
        height:         'var(--titlebar-h)',
        background:     'var(--surface)',
        borderBottom:   '1px solid var(--border)',
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'space-between',
        padding:        '0 0 0 10px',
        flexShrink:     0,
        WebkitAppRegion: 'drag',
        zIndex:         1000,
        position:       'relative',
      }}>
        {/* Left — Orb + identity */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', WebkitAppRegion: 'no-drag' }}>
          {/* Orb — click to toggle palette */}
          <div onClick={togglePalette} style={{ cursor: 'pointer' }}>
            <RamaOrb size={22} active={isThinking || voiceActive} />
          </div>

          <div
            onClick={() => !masterAuthenticated && setShowAuth(true)}
            style={{ cursor: masterAuthenticated ? 'default' : 'pointer' }}
          >
            <span style={{
              fontFamily:    'var(--font-display)',
              fontSize:      '13px',
              fontWeight:    700,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              background:    masterAuthenticated
                ? 'linear-gradient(135deg, #4dd9ff 0%, #00c8ff 50%, #d4a940 100%)'
                : 'linear-gradient(135deg, #6a9bc0, #4a7a9a)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
              filter:        masterAuthenticated ? 'drop-shadow(0 0 6px rgba(0,200,255,0.5))' : 'none',
              lineHeight:    '1.2',
              display:       'block',
            }}>
              {masterAuthenticated ? 'RĀMA AGI' : 'ASSISTANT'}
            </span>
            {masterAuthenticated && (
              <span style={{ fontSize: '9px', color: 'rgba(212,169,64,0.6)', letterSpacing: '0.08em',
                fontFamily: 'var(--font)', display: 'block' }}>
                SUPER AGI · MASTER AUTHENTICATED
              </span>
            )}
          </div>

          {/* Palette toggle hint */}
          <div onClick={togglePalette}
            style={{
              padding:      '2px 7px',
              background:   paletteOpen ? 'rgba(0,200,255,0.08)' : 'transparent',
              border:       `1px solid ${paletteOpen ? 'rgba(0,200,255,0.35)' : 'var(--border)'}`,
              borderRadius: '3px',
              color:        paletteOpen ? 'var(--accent)' : 'var(--muted)',
              fontSize:     '9px',
              cursor:       'pointer',
              letterSpacing:'0.06em',
              WebkitAppRegion: 'no-drag',
              transition:   'all 0.15s',
            }}>
            Ctrl+K
          </div>

          {/* Current user pill */}
          {currentUser && tierBadge && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px',
              padding: '2px 8px', background: `${tierBadge.color}10`,
              border: `1px solid ${tierBadge.color}28`, borderRadius: '3px',
              WebkitAppRegion: 'no-drag' }}>
              <span style={{ fontSize: '9px', color: tierBadge.color, fontWeight: 700 }}>
                {currentUser.tier === TIERS.MASTER ? '◈' : '◎'}
              </span>
              <span style={{ fontSize: '10px', color: tierBadge.color, fontFamily: 'var(--font-display)' }}>
                {currentUser.name}
              </span>
            </div>
          )}
        </div>

        {/* Center — metrics + clock */}
        <div style={{
          display:        'flex',
          alignItems:     'center',
          gap:            '8px',
          WebkitAppRegion: 'no-drag',
        }}>
          <MetricPill label="CPU" value={cpu} />
          <MetricPill label="RAM" value={ram} />
          <Clock />
          {voiceActive && (
            <div style={{
              width: '6px', height: '6px', borderRadius: '50%',
              background: 'var(--magenta)',
              boxShadow: 'var(--glow-magenta)',
              animation: 'pulse-ring 1.2s ease infinite',
            }} title="Voice active — say 'Hey Rāma'" />
          )}
        </div>

        {/* Right — window controls */}
        <div style={{
          display:        'flex',
          alignItems:     'center',
          WebkitAppRegion: 'no-drag',
          height:         '100%',
        }}>
          {/* Logout button */}
          {currentUser && currentUser.tier !== TIERS.GUEST && (
            <button onClick={handleLogout} title="Sign out"
              style={{ padding: '0 10px', height: '100%', border: 'none', background: 'transparent',
                color: 'var(--muted)', cursor: 'pointer', fontSize: '11px', fontFamily: 'var(--font)',
                transition: 'color 0.15s', WebkitAppRegion: 'no-drag' }}
              onMouseEnter={e => e.currentTarget.style.color = 'var(--amber)'}
              onMouseLeave={e => e.currentTarget.style.color = 'var(--muted)'}>
              ⇥
            </button>
          )}
          <TitleBtn onClick={minimize} label="─" title="Minimize"                    color="var(--text-dim)" hoverColor="var(--amber)" />
          <TitleBtn onClick={maximize} label={maximized ? '❐' : '□'} title="Maximize" color="var(--text-dim)" hoverColor="var(--accent)" />
          <TitleBtn onClick={close}    label="✕" title="Close"                        color="var(--text-dim)" hoverColor="var(--red)" isClose />
        </div>
      </div>
    </>
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
        background: hover ? (isClose ? 'rgba(255,0,60,0.15)' : 'rgba(0,255,255,0.06)') : 'transparent',
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
