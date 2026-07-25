import React, { useState, useEffect, useRef } from 'react';
import RamaOrb from '@components/RamaOrb.jsx';

const isElectron = typeof window !== 'undefined' && !!window.rama;

/**
 * Unlock — First screen shown on every app launch.
 * Master passcode → Argon2id KDF → AES-256-GCM key → decrypt all data.
 * Without the correct passcode, nothing is accessible.
 *
 * First-run: asks to SET a passcode.
 * Subsequent: asks to ENTER the passcode.
 */
export default function Unlock({ onUnlocked }) {
  const [passcode,    setPasscode]    = useState('');
  const [confirm,     setConfirm]     = useState('');
  const [isFirstRun,  setIsFirstRun]  = useState(false);
  const [checking,    setChecking]    = useState(true);
  const [unlocking,   setUnlocking]   = useState(false);
  const [error,       setError]       = useState('');
  const [showPwd,     setShowPwd]     = useState(false);
  const inputRef = useRef(null);

  // Check if first run
  useEffect(() => {
    const check = async () => {
      if (!isElectron) {
        // Dev browser mode — skip encryption, go straight to login
        setChecking(false);
        onUnlocked?.({ devMode: true });
        return;
      }
      try {
        const res = await window.rama.session?.isFirstRun?.() ??
                    await window.ipcRenderer?.invoke('session:is-first-run');
        setIsFirstRun(res?.firstRun ?? false);
      } catch {
        setIsFirstRun(false);
      }
      setChecking(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    };
    check();
  }, [onUnlocked]);

  const handleUnlock = async () => {
    const code = passcode.trim();
    if (!code) { setError('Passcode required'); return; }

    if (isFirstRun) {
      if (code !== confirm.trim()) { setError('Passcodes do not match'); return; }
      if (code.length < 10) { setError('Passcode must be at least 10 characters'); return; }
    }

    setUnlocking(true);
    setError('');

    try {
      const res = isElectron
        ? await window.ipcRenderer?.invoke('session:unlock', code) ??
          { ok: false, error: 'IPC not available' }
        : { ok: true, devMode: true };   // non-Electron fallback

      if (res.ok) {
        onUnlocked?.({ ...res, firstRun: isFirstRun });
      } else {
        setError(res.error || 'Incorrect passcode');
        setPasscode('');
        setConfirm('');
        setTimeout(() => inputRef.current?.focus(), 50);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setUnlocking(false);
    }
  };

  if (checking) {
    return (
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--bg)', flexDirection: 'column', gap: '16px' }}>
        <RamaOrb size={40} active />
        <span style={{ color: 'var(--muted)', fontSize: '11px', letterSpacing: '0.1em' }}>
          INITIALIZING...
        </span>
      </div>
    );
  }

  return (
    <div style={{ height: '100vh', width: '100vw',
      background: 'radial-gradient(ellipse 80% 60% at 50% -10%, rgba(0,100,180,0.15), transparent 60%), var(--bg)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}
      className="grid-bg"
    >
      {/* Logo-inspired radiant glow behind card */}
      <div style={{ position: 'absolute', top: '15%', left: '50%', transform: 'translateX(-50%)',
        width: '700px', height: '500px', borderRadius: '50%',
        background: 'radial-gradient(ellipse, rgba(0,200,255,0.07) 0%, rgba(212,169,64,0.03) 40%, transparent 70%)',
        pointerEvents: 'none', filter: 'blur(20px)' }} />

      <div className="neural-card fade-in" style={{
        width: '400px', padding: '40px', display: 'flex',
        flexDirection: 'column', gap: '28px', position: 'relative', zIndex: 1,
      }}>

        {/* Header */}
        <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '14px' }}>
          <RamaOrb size={56} />
          <div>
            <div className="title-glow" style={{ fontSize: '22px' }}>
              RĀMA AGI
            </div>
            <div style={{ fontSize: '11px', color: 'rgba(212,169,64,0.7)', marginTop: '4px',
              letterSpacing: '0.2em', fontFamily: 'var(--font-display)', textTransform: 'uppercase' }}>
              SUPER AGI
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-dim)', marginTop: '8px', letterSpacing: '0.05em' }}>
              {isFirstRun
                ? 'First launch — set your master passcode'
                : 'Enter master passcode to unlock'}
            </div>
          </div>

          {/* Encryption notice — styled like the logo's tech readout */}
          <div style={{
            display:      'flex', alignItems: 'center', gap: '8px',
            padding:      '6px 14px',
            background:   'rgba(0,200,255,0.05)',
            border:       '1px solid rgba(0,200,255,0.15)',
            borderRadius: 'var(--radius)',
            fontSize:     '10px', color: 'rgba(0,200,255,0.7)',
            letterSpacing:'0.06em',
          }}>
            <span style={{ color: 'var(--gold)', fontSize: '12px' }}>⬢</span>
            AES-256-GCM · Argon2id · HMAC-SHA512
          </div>
        </div>

        {/* Form */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <div className="section-label" style={{ marginBottom: '6px' }}>
              {isFirstRun ? 'CREATE MASTER PASSCODE' : 'MASTER PASSCODE'}
            </div>
            <div style={{ position: 'relative' }}>
              <input
                ref={inputRef}
                className="input"
                type={showPwd ? 'text' : 'password'}
                placeholder={isFirstRun ? 'Min 10 characters — choose strong' : '••••••••••••••••'}
                value={passcode}
                onChange={e => { setPasscode(e.target.value); setError(''); }}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    if (isFirstRun && !confirm) document.getElementById('confirm-input')?.focus();
                    else handleUnlock();
                  }
                }}
                autoComplete="current-password"
                style={{ paddingRight: '36px', fontFamily: 'var(--font)', letterSpacing: showPwd ? 'normal' : '0.2em' }}
              />
              <button type="button" onClick={() => setShowPwd(v => !v)} style={{
                position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)',
                background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer',
                fontSize: '13px', fontFamily: 'var(--font)',
              }}>{showPwd ? '🙈' : '👁'}</button>
            </div>
          </div>

          {isFirstRun && (
            <div>
              <div className="section-label" style={{ marginBottom: '6px' }}>CONFIRM PASSCODE</div>
              <input
                id="confirm-input"
                className="input"
                type={showPwd ? 'text' : 'password'}
                placeholder="Re-enter passcode"
                value={confirm}
                onChange={e => { setConfirm(e.target.value); setError(''); }}
                onKeyDown={e => e.key === 'Enter' && handleUnlock()}
                autoComplete="new-password"
                style={{ fontFamily: 'var(--font)', letterSpacing: showPwd ? 'normal' : '0.2em' }}
              />
            </div>
          )}

          {error && (
            <div style={{ color: 'var(--red)', fontSize: '11px', padding: '8px 10px',
              background: 'rgba(255,0,60,0.08)', border: '1px solid rgba(255,0,60,0.25)',
              borderRadius: 'var(--radius)' }}>
              {error}
            </div>
          )}

          <button className="btn btn-primary" disabled={unlocking || !passcode}
            onClick={handleUnlock}
            style={{ width: '100%', justifyContent: 'center', padding: '12px',
              fontSize: '13px', letterSpacing: '0.1em', marginTop: '4px',
              fontFamily: 'var(--font-display)',
              background: unlocking ? 'var(--border)' : 'linear-gradient(135deg, rgba(0,200,255,0.12), rgba(0,200,255,0.06))',
              borderColor: unlocking ? 'var(--border)' : 'rgba(0,200,255,0.4)',
              color: unlocking ? 'var(--muted)' : 'var(--accent)',
              boxShadow: (!unlocking && passcode) ? 'var(--glow-cyan)' : 'none' }}>
            {unlocking
              ? '⬢ Deriving key...'
              : isFirstRun
              ? '⚡ Initialize Rāma AGI'
              : '⚡ Unlock Rāma AGI'}
          </button>
        </div>

        {/* Security note */}
        <div style={{ fontSize: '10px', color: 'var(--muted)', textAlign: 'center', lineHeight: '1.7' }}>
          {isFirstRun
            ? 'This passcode encrypts ALL data. Store it securely.\nThere is no recovery without it.'
            : 'All data is encrypted at rest.\nThis passcode is never stored anywhere.'}
        </div>
      </div>
    </div>
  );
}
