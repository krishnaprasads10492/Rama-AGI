import React, { useEffect, useState, useCallback } from 'react';
import { useUIStore }   from '@store/uiStore.js';
import { useRamaStore } from '@store/ramaStore.js';
import { useUserStore } from '@store/userStore.js';
import { authenticateMaster } from '@services/consciousness.js';
import { authApi, clearSession } from '@services/authClient.js';
import { getTierBadge, TIERS } from '@services/accessControl.js';
import RamaOrb from './RamaOrb.jsx';

const isElectron = typeof window !== 'undefined' && !!window.rama;

// ─── Live system metrics ─────────────────────────────────────────────────────
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
    const id = setInterval(poll, 5000);   // 5s — was 3s, reduced for perf
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
  const color = value >= danger ? 'var(--red)' : value >= warn ? 'var(--gold)' : 'var(--accent)';
  return (
    <div className="metric-pill no-drag" style={{ borderColor: color + '44' }}>
      <span style={{ color: 'var(--muted)', fontSize: '10px' }}>{label}</span>
      <span style={{ color, fontWeight: 700, minWidth: '28px', textAlign: 'right' }}>{value}%</span>
    </div>
  );
}

// ─── Master auth modal ────────────────────────────────────────────────────────
function AuthModal({ onClose }) {
  const [password, setPassword] = useState('');
  const [error,    setError]    = useState('');
  const { setMasterAuth } = useUIStore();
  const { currentUser } = useUserStore();

  const tryAuth = async () => {
    if (!password) return;
    if (!isElectron) {
      authenticateMaster(true);
      setMasterAuth(true);
      onClose();
      return;
    }
    const res = await window.rama.vault.unlock(currentUser, password);
    if (res.ok) {
      authenticateMaster(true);
      setMasterAuth(true);
      onClose();
    } else {
      setError('Authentication failed');
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 900 }}
      onClick={onClose}>
      <div className="neural-card" onClick={e => e.stopPropagation()}
        style={{ width: '380px', padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <RamaOrb size={32} />
          <div>
            <div className="title-glow" style={{ fontSize: '14px' }}>IDENTITY VERIFICATION</div>
            <div style={{ fontSize: '10px', color: 'var(--muted)' }}>
              Authenticate as master to reveal full AGI identity
            </div>
          </div>
        </div>
        <input className="input" type="password" placeholder="Master password"
          value={password} onChange={e => { setPassword(e.target.value); setError(''); }}
          onKeyDown={e => e.key === 'Enter' && tryAuth()} autoFocus />
        {error && <div style={{ color: 'var(--red)', fontSize: '11px' }}>{error}</div>}
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button className="btn btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn btn-sm btn-primary" onClick={tryAuth}>Authenticate</button>
        </div>
      </div>
    </div>
  );
}

// ─── Window control button ────────────────────────────────────────────────────
function TitleBtn({ onClick, label, title, hoverColor, isClose }) {
  const [hover, setHover] = useState(false);
  return (
    <button onClick={onClick} title={title}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        width: '46px', height: 'var(--titlebar-h)', border: 'none',
        background: hover ? (isClose ? 'rgba(255,64,96,0.15)' : 'rgba(0,200,255,0.06)') : 'transparent',
        color: hover ? hoverColor : 'var(--text-dim)',
        cursor: 'pointer', fontSize: '13px', display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        transition: 'all 0.15s', WebkitAppRegion: 'no-drag',
      }}>
      {label}
    </button>
  );
}

// ─── Main Titlebar ────────────────────────────────────────────────────────────
export default function Titlebar() {
  const { cpu, ram } = useMetrics();
  const [maximized, setMaximized] = useState(false);
  const [showAuth,  setShowAuth]  = useState(false);

  const { togglePalette, paletteOpen, voiceActive, masterAuthenticated } = useUIStore();
  const { isThinking } = useRamaStore();
  const { currentUser, clearSession: clearUserSession, sessionToken } = useUserStore();

  useEffect(() => {
    if (!isElectron) return;
    setMaximized(window.rama.window.isMaximized());
    return window.rama.window.onMaximized(setMaximized);
  }, []);

  const minimize = useCallback(() => isElectron && window.rama.window.minimize(), []);
  const maximize = useCallback(() => isElectron && window.rama.window.maximize(), []);
  const close    = useCallback(() => isElectron && window.rama.window.close(), []);

  const handleLogout = useCallback(async () => {
    if (sessionToken) await authApi.logout(sessionToken).catch(() => {});
    clearSession();
    clearUserSession();
    authenticateMaster(false);
    window.location.reload();
  }, [sessionToken, clearUserSession]);

  const tierBadge = currentUser ? getTierBadge(currentUser.tier) : null;

  return (
    <>
      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
      <div style={{
        height: 'var(--titlebar-h)', background: 'var(--surface)',
        borderBottom: '1px solid var(--border)', display: 'flex',
        alignItems: 'center', justifyContent: 'space-between',
        padding: '0 0 0 10px', flexShrink: 0,
        WebkitAppRegion: 'drag', zIndex: 1000, position: 'relative',
      }}>
        {/* Left — Orb + identity */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', WebkitAppRegion: 'no-drag' }}>
          <div onClick={togglePalette} style={{ cursor: 'pointer' }}>
            <RamaOrb size={22} active={isThinking || voiceActive} />
          </div>

          <div onClick={() => !masterAuthenticated && setShowAuth(true)}
            style={{ cursor: masterAuthenticated ? 'default' : 'pointer' }}>
            <span style={{
              fontFamily: 'var(--font-display)', fontSize: '13px', fontWeight: 700,
              letterSpacing: '0.14em', textTransform: 'uppercase',
              background: masterAuthenticated
                ? 'linear-gradient(135deg, #4dd9ff 0%, #00c8ff 50%, #d4a940 100%)'
                : 'linear-gradient(135deg, #6a9bc0, #4a7a9a)',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
              filter: masterAuthenticated ? 'drop-shadow(0 0 6px rgba(0,200,255,0.5))' : 'none',
              lineHeight: '1.2', display: 'block',
            }}>
              {masterAuthenticated ? 'RĀMA AGI' : 'ASSISTANT'}
            </span>
            {masterAuthenticated && (
              <span style={{ fontSize: '9px', color: 'rgba(212,169,64,0.6)',
                letterSpacing: '0.08em', fontFamily: 'var(--font)', display: 'block' }}>
                SUPER AGI · MASTER AUTHENTICATED
              </span>
            )}
          </div>

          <div onClick={togglePalette} style={{
            padding: '2px 7px',
            background: paletteOpen ? 'rgba(0,200,255,0.08)' : 'transparent',
            border: `1px solid ${paletteOpen ? 'rgba(0,200,255,0.35)' : 'var(--border)'}`,
            borderRadius: '3px',
            color: paletteOpen ? 'var(--accent)' : 'var(--muted)',
            fontSize: '9px', cursor: 'pointer', letterSpacing: '0.06em',
            WebkitAppRegion: 'no-drag', transition: 'all 0.15s',
          }}>Ctrl+K</div>

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

        {/* Center — metrics */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', WebkitAppRegion: 'no-drag' }}>
          <MetricPill label="CPU" value={cpu} />
          <MetricPill label="RAM" value={ram} />
          <Clock />
          {voiceActive && (
            <div title="Voice active — say 'Hey Rāma'" style={{
              width: '6px', height: '6px', borderRadius: '50%',
              background: 'var(--magenta)', boxShadow: 'var(--glow-magenta)',
              animation: 'pulse-ring 1.2s ease infinite',
            }} />
          )}
        </div>

        {/* Right — window controls */}
        <div style={{ display: 'flex', alignItems: 'center',
          WebkitAppRegion: 'no-drag', height: '100%' }}>
          {currentUser && currentUser.tier !== TIERS.GUEST && (
            <button onClick={handleLogout} title="Sign out" style={{
              padding: '0 10px', height: '100%', border: 'none', background: 'transparent',
              color: 'var(--muted)', cursor: 'pointer', fontSize: '11px',
              fontFamily: 'var(--font)', transition: 'color 0.15s', WebkitAppRegion: 'no-drag',
            }}
              onMouseEnter={e => e.currentTarget.style.color = 'var(--gold)'}
              onMouseLeave={e => e.currentTarget.style.color = 'var(--muted)'}>⇥</button>
          )}
          <TitleBtn onClick={minimize} label="─" title="Minimize" hoverColor="var(--gold)" />
          <TitleBtn onClick={maximize} label={maximized ? '❐' : '□'} title="Maximize" hoverColor="var(--accent)" />
          <TitleBtn onClick={close}    label="✕" title="Close" hoverColor="var(--red)" isClose />
        </div>
      </div>
    </>
  );
}
