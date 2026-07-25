import React, { useState, useEffect } from 'react';
import { useUserStore }  from '@store/userStore.js';
import { authApi, saveSession } from '@services/authClient.js';
import { authenticateMaster }   from '@services/consciousness.js';
import { TIERS, getTierBadge }  from '@services/accessControl.js';
import RamaOrb from '@components/RamaOrb.jsx';

/**
 * Login — shown before any page is accessible.
 * Master login unlocks full Rāma identity.
 * Other users get scoped access per their tier.
 */
export default function Login({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);
  const [showPwd,  setShowPwd]  = useState(false);

  const { setSession, setAuthError } = useUserStore();

  const handleLogin = async (e) => {
    e?.preventDefault();
    if (!username.trim() || !password.trim()) {
      setError('Enter username and password');
      return;
    }
    setLoading(true);
    setError('');

    const res = await authApi.login(username.trim(), password);
    setLoading(false);

    if (!res.ok) {
      setError(res.error || 'Login failed');
      return;
    }

    const { token, user } = res;
    saveSession(token, user);
    setSession(user, token);

    // If master → unlock full AGI identity
    if (user.tier === TIERS.MASTER) {
      authenticateMaster(true);
    }

    onLogin?.(user);
  };

  const loginAsGuest = () => {
    const guestUser = { id: `guest_${Date.now()}`, name: 'Guest', tier: TIERS.GUEST, expiresAt: Date.now() + 3600000 };
    setSession(guestUser, null);
    onLogin?.(guestUser);
  };

  return (
    <div style={{
      height:         '100vh',
      width:          '100vw',
      background:     'var(--bg)',
      display:        'flex',
      alignItems:     'center',
      justifyContent: 'center',
      position:       'relative',
      overflow:       'hidden',
    }}
      className="grid-bg"
    >
      {/* Background glow */}
      <div style={{
        position: 'absolute', top: '20%', left: '50%', transform: 'translateX(-50%)',
        width: '600px', height: '600px', borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(119,0,255,0.08), transparent 70%)',
        pointerEvents: 'none',
      }} />

      {/* Login card */}
      <div className="hud-card fade-in" style={{
        width:   '380px',
        padding: '36px',
        display: 'flex',
        flexDirection: 'column',
        gap:     '24px',
        position: 'relative',
        zIndex:  1,
      }}>
        {/* Header */}
        <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
          <RamaOrb size={48} />
          <div>
            <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--violet)', letterSpacing: '0.12em' }}>
              RĀMA AGI
            </div>
            <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '4px', letterSpacing: '0.06em' }}>
              Identify yourself to proceed
            </div>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div>
            <div className="section-label" style={{ marginBottom: '5px' }}>USERNAME OR EMAIL</div>
            <input
              className="input"
              type="text"
              placeholder="e.g. Krishna Prasad"
              value={username}
              onChange={e => { setUsername(e.target.value); setError(''); }}
              autoFocus
              autoComplete="username"
            />
          </div>

          <div>
            <div className="section-label" style={{ marginBottom: '5px' }}>PASSWORD</div>
            <div style={{ position: 'relative' }}>
              <input
                className="input"
                type={showPwd ? 'text' : 'password'}
                placeholder="••••••••••••"
                value={password}
                onChange={e => { setPassword(e.target.value); setError(''); }}
                autoComplete="current-password"
                style={{ paddingRight: '36px' }}
              />
              <button type="button" onClick={() => setShowPwd(v => !v)}
                style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: '12px',
                  fontFamily: 'var(--font)' }}>
                {showPwd ? '🙈' : '👁'}
              </button>
            </div>
          </div>

          {error && (
            <div style={{ color: 'var(--red)', fontSize: '11px', padding: '8px 10px',
              background: 'rgba(255,0,60,0.08)', border: '1px solid rgba(255,0,60,0.3)',
              borderRadius: 'var(--radius)' }}>
              {error}
            </div>
          )}

          <button type="submit" disabled={loading}
            className="btn btn-primary"
            style={{ width: '100%', justifyContent: 'center', padding: '10px', marginTop: '4px' }}>
            {loading ? 'Authenticating...' : '⚡ Enter Rāma'}
          </button>
        </form>

        {/* Divider */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ flex: 1, height: '1px', background: 'var(--border)' }} />
          <span style={{ fontSize: '10px', color: 'var(--muted)' }}>OR</span>
          <div style={{ flex: 1, height: '1px', background: 'var(--border)' }} />
        </div>

        {/* Guest */}
        <button className="btn" onClick={loginAsGuest}
          style={{ width: '100%', justifyContent: 'center', color: 'var(--muted)', fontSize: '11px' }}>
          Continue as Guest (limited access)
        </button>

        {/* Access level hint */}
        <div style={{ fontSize: '10px', color: 'var(--muted)', textAlign: 'center', lineHeight: '1.6' }}>
          Access level determined by your account tier.<br />
          Master account unlocks full Rāma AGI identity.
        </div>
      </div>
    </div>
  );
}
