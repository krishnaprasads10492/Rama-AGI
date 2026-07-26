import React, { useCallback, useEffect, useRef, useState } from 'react';
import RamaOrb from '@components/RamaOrb.jsx';
import { useUserStore } from '@store/userStore.js';
import { authApi, keyApi, saveSession, inElectron } from '@services/authClient.js';
import { authenticateMaster } from '@services/consciousness.js';
import { TIERS } from '@services/accessControl.js';

/**
 * Login — gates 2 and 3 of the three-gate sign-in.
 *
 *   Gate 1  passcode      → Unlock.jsx (already passed to reach this screen)
 *   Gate 2  password      → a 10-minute step token, never a session
 *   Gate 3  12-digit key  → the session token
 *
 * A stolen password alone gets nowhere, and a stolen key alone gets nowhere.
 * If the account has no key yet (or it expired) the screen mints one in place
 * rather than dead-ending — the user never has to touch the source to recover.
 */

const PHASES = {
  PASSWORD: 'password',   // gate 2
  KEY:      'key',        // gate 3
  KEY_ISSUED: 'issued',   // a new key was just minted — show it once
  RECOVER:  'recover',    // lost key: username + password → new key
};

// ─── 12-digit key input, grouped 4-4-4 ────────────────────────────────────────
function KeyInput({ value, onChange, onSubmit, autoFocus }) {
  const ref = useRef(null);

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  // Format as the user types, but keep the raw digits as the value
  const display = (() => {
    const d = value;
    return [d.slice(0, 4), d.slice(4, 8), d.slice(8, 12)].filter(Boolean).join('-');
  })();

  return (
    <input
      ref={ref}
      className="input"
      inputMode="numeric"
      autoComplete="one-time-code"
      placeholder="0000-0000-0000"
      value={display}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 12))}
      onKeyDown={(e) => { if (e.key === 'Enter' && value.length === 12) onSubmit?.(); }}
      style={{
        fontFamily: 'monospace', fontSize: '20px', letterSpacing: '0.16em',
        textAlign: 'center', padding: '12px',
      }}
    />
  );
}

function ErrorBox({ children }) {
  if (!children) return null;
  return (
    <div style={{
      color: 'var(--red)', fontSize: '11px', padding: '8px 10px',
      background: 'rgba(255,0,60,0.08)', border: '1px solid rgba(255,0,60,0.3)',
      borderRadius: 'var(--radius)', lineHeight: '1.6',
    }}>
      {children}
    </div>
  );
}

function Field({ label, hint, children }) {
  return (
    <div>
      <div className="section-label" style={{ marginBottom: '5px' }}>{label}</div>
      {children}
      {hint && <div style={{ fontSize: '9px', color: 'var(--muted)', marginTop: '4px' }}>{hint}</div>}
    </div>
  );
}

function GateDots({ phase }) {
  const done = phase === PHASES.PASSWORD ? 1 : 2;
  return (
    <div style={{ display: 'flex', gap: '5px', justifyContent: 'center', alignItems: 'center' }}>
      {[1, 2, 3].map(n => (
        <div key={n} title={`Gate ${n}`} style={{
          width: n === done ? '18px' : '6px', height: '6px', borderRadius: '3px',
          background: n <= done ? 'var(--violet)' : 'var(--border)',
          transition: 'all 0.2s',
        }} />
      ))}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function Login({ onLogin }) {
  const { setSession } = useUserStore();

  const [phase,    setPhase]    = useState(PHASES.PASSWORD);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd,  setShowPwd]  = useState(false);
  const [key,      setKey]      = useState('');
  const [stepToken, setStepToken] = useState(null);
  const [issued,   setIssued]   = useState(null);   // { key, expiresAt }
  const [error,    setError]    = useState('');
  const [busy,     setBusy]     = useState(false);
  const [stepLeft, setStepLeft] = useState(0);      // seconds on the step token

  // Step tokens expire in 10 minutes. Show the remaining time rather than
  // letting the user discover it by failing.
  useEffect(() => {
    if (!stepToken || phase !== PHASES.KEY) return;
    const id = setInterval(() => {
      setStepLeft(s => {
        if (s <= 1) {
          setPhase(PHASES.PASSWORD);
          setStepToken(null);
          setError('That sign-in attempt expired. Enter your password again.');
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [stepToken, phase]);

  const resetToPassword = useCallback(() => {
    setPhase(PHASES.PASSWORD);
    setStepToken(null);
    setKey('');
    setIssued(null);
    setError('');
  }, []);

  // ── Gate 2 ────────────────────────────────────────────────────────────────
  const submitPassword = useCallback(async (e) => {
    e?.preventDefault();
    if (!username.trim() || !password) { setError('Enter your username and password'); return; }

    setBusy(true);
    setError('');
    const res = await authApi.step1(username, password);
    setBusy(false);

    if (!res?.ok) { setError(res?.error || 'Sign-in failed'); return; }

    setStepToken(res.stepToken);
    setStepLeft(Math.floor((res.expiresInMs ?? 600000) / 1000));

    // No key on file, or it lapsed — mint one now instead of dead-ending
    if (!res.hasKey || res.keyExpired) {
      const gen = await keyApi.fromStepToken(res.stepToken);
      if (!gen?.ok) {
        setError(gen?.error || 'Could not issue an access key');
        setPhase(PHASES.KEY);
        return;
      }
      setIssued({ key: gen.key, expiresAt: gen.expiresAt, reason: res.keyExpired ? 'expired' : 'missing' });
      setPhase(PHASES.KEY_ISSUED);
      return;
    }

    setPhase(PHASES.KEY);
  }, [username, password]);

  // ── Gate 3 ────────────────────────────────────────────────────────────────
  const submitKey = useCallback(async () => {
    if (key.length !== 12) { setError('The access key is 12 digits'); return; }

    setBusy(true);
    setError('');
    const res = await authApi.step2(stepToken, key);
    setBusy(false);

    if (!res?.ok) {
      setError(res?.error || 'Invalid access key');
      if (res?.needsKeygen) {
        const gen = await keyApi.fromStepToken(stepToken);
        if (gen?.ok) {
          setIssued({ key: gen.key, expiresAt: gen.expiresAt, reason: 'expired' });
          setPhase(PHASES.KEY_ISSUED);
        }
      }
      setKey('');
      return;
    }

    saveSession(res.token, { ...res.user, expiresAt: res.expiresAt });
    setSession({ ...res.user, expiresAt: res.expiresAt }, res.token);

    // Rāma reveals its true identity only to its master
    if (res.user?.tier === TIERS.MASTER) authenticateMaster(true);

    onLogin?.(res.user, res.token);
  }, [key, stepToken, setSession, onLogin]);

  // ── Lost key ──────────────────────────────────────────────────────────────
  const recover = useCallback(async (e) => {
    e?.preventDefault();
    if (!username.trim() || !password) { setError('Enter your username and password'); return; }

    setBusy(true);
    setError('');
    const res = await keyApi.fromCredentials(username, password);
    setBusy(false);

    if (!res?.ok) { setError(res?.error || 'Could not issue a new key'); return; }

    setStepToken(res.stepToken ?? null);
    setStepLeft(600);
    setIssued({ key: res.key, expiresAt: res.expiresAt, reason: 'recovered' });
    setPhase(PHASES.KEY_ISSUED);
  }, [username, password]);

  const continueFromIssued = useCallback(() => {
    setIssued(null);
    setKey('');
    setError('');
    setPhase(stepToken ? PHASES.KEY : PHASES.PASSWORD);
  }, [stepToken]);

  const subtitle = {
    [PHASES.PASSWORD]:  'Gate 2 of 3 — prove who you are',
    [PHASES.KEY]:       'Gate 3 of 3 — prove you hold the key',
    [PHASES.KEY_ISSUED]:'A new access key was issued',
    [PHASES.RECOVER]:   'Issue a replacement access key',
  }[phase];

  return (
    <div className="grid-bg" style={{
      height: '100vh', width: '100vw', background: 'var(--bg)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      position: 'relative', overflow: 'auto',
    }}>
      <div style={{
        position: 'absolute', top: '20%', left: '50%', transform: 'translateX(-50%)',
        width: '600px', height: '600px', borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(119,0,255,0.08), transparent 70%)',
        pointerEvents: 'none',
      }} />

      <div className="hud-card fade-in" style={{
        width: '400px', maxWidth: '92vw', padding: '34px',
        display: 'flex', flexDirection: 'column', gap: '20px',
        position: 'relative', zIndex: 1, margin: '28px 0',
      }}>
        {/* Header */}
        <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
          <RamaOrb size={46} />
          <div>
            <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--violet)', letterSpacing: '0.12em' }}>
              RĀMA AGI
            </div>
            <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '4px', letterSpacing: '0.04em' }}>
              {subtitle}
            </div>
          </div>
          {(phase === PHASES.PASSWORD || phase === PHASES.KEY) && <GateDots phase={phase} />}
        </div>

        {!inElectron() && (
          <div style={{
            fontSize: '10px', color: 'var(--amber)', lineHeight: '1.7',
            padding: '9px 11px', background: 'rgba(255,170,0,0.06)',
            border: '1px solid rgba(255,170,0,0.25)', borderRadius: 'var(--radius)',
          }}>
            Browser mode. Accounts live in the encrypted store, which only the
            desktop app can open, so sign-in is unavailable here.
          </div>
        )}

        {/* ── Gate 2 — password ──────────────────────────────────────────── */}
        {phase === PHASES.PASSWORD && (
          <form onSubmit={submitPassword} style={{ display: 'flex', flexDirection: 'column', gap: '13px' }}>
            <Field label="USERNAME">
              <input
                className="input"
                value={username}
                autoFocus
                autoComplete="username"
                onChange={e => { setUsername(e.target.value.toLowerCase()); setError(''); }}
              />
            </Field>

            <Field label="PASSWORD">
              <div style={{ position: 'relative' }}>
                <input
                  className="input"
                  type={showPwd ? 'text' : 'password'}
                  value={password}
                  autoComplete="current-password"
                  onChange={e => { setPassword(e.target.value); setError(''); }}
                  style={{ paddingRight: '38px' }}
                />
                <button type="button" onClick={() => setShowPwd(v => !v)}
                  aria-label={showPwd ? 'Hide password' : 'Show password'}
                  style={{
                    position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)',
                    background: 'none', border: 'none', color: 'var(--muted)',
                    cursor: 'pointer', fontSize: '12px', fontFamily: 'var(--font)',
                  }}>
                  {showPwd ? 'hide' : 'show'}
                </button>
              </div>
            </Field>

            <ErrorBox>{error}</ErrorBox>

            <button type="submit" className="btn btn-primary" disabled={busy}
              style={{ width: '100%', justifyContent: 'center', padding: '10px' }}>
              {busy ? 'Verifying...' : 'Continue →'}
            </button>

            <button type="button" className="btn"
              onClick={() => { setPhase(PHASES.RECOVER); setError(''); }}
              style={{ justifyContent: 'center', fontSize: '10px', color: 'var(--muted)' }}>
              I lost my access key
            </button>
          </form>
        )}

        {/* ── Gate 3 — access key ────────────────────────────────────────── */}
        {phase === PHASES.KEY && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '13px' }}>
            <Field label="12-DIGIT ACCESS KEY"
              hint={stepLeft > 0 ? `This attempt expires in ${Math.floor(stepLeft / 60)}:${String(stepLeft % 60).padStart(2, '0')}` : undefined}>
              <KeyInput value={key} onChange={(v) => { setKey(v); setError(''); }} onSubmit={submitKey} autoFocus />
            </Field>

            <ErrorBox>{error}</ErrorBox>

            <button className="btn btn-primary" disabled={busy || key.length !== 12} onClick={submitKey}
              style={{ width: '100%', justifyContent: 'center', padding: '10px' }}>
              {busy ? 'Authenticating...' : '⚡ Enter Rāma'}
            </button>

            <button className="btn" onClick={resetToPassword}
              style={{ justifyContent: 'center', fontSize: '10px', color: 'var(--muted)' }}>
              ← Start over
            </button>
          </div>
        )}

        {/* ── A key was just minted — shown exactly once ─────────────────── */}
        {phase === PHASES.KEY_ISSUED && issued && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
            <div style={{
              fontSize: '11px', color: 'var(--text-dim)', lineHeight: '1.7',
              padding: '9px 11px', background: 'rgba(0,200,255,0.05)',
              border: '1px solid rgba(0,200,255,0.25)', borderRadius: 'var(--radius)',
            }}>
              {issued.reason === 'expired'   && 'Your previous key had expired, so a new one was issued.'}
              {issued.reason === 'missing'   && 'This account had no access key yet, so one was issued.'}
              {issued.reason === 'recovered' && 'Your password checked out. The old key no longer works.'}
            </div>

            <div>
              <div className="section-label" style={{ marginBottom: '6px' }}>YOUR NEW ACCESS KEY</div>
              <div style={{
                fontFamily: 'monospace', fontSize: '22px', letterSpacing: '0.14em',
                textAlign: 'center', padding: '16px', color: 'var(--gold)',
                background: 'var(--surface)', border: '1px solid var(--border)',
                borderRadius: 'var(--radius)', userSelect: 'all',
              }}>
                {issued.key}
              </div>
              <div style={{ display: 'flex', gap: '8px', marginTop: '8px', alignItems: 'center' }}>
                <button className="btn btn-sm" style={{ flex: 1, justifyContent: 'center' }}
                  onClick={() => navigator.clipboard?.writeText(issued.key)}>
                  Copy
                </button>
                <span style={{ fontSize: '9px', color: 'var(--muted)' }}>
                  Expires {new Date(issued.expiresAt).toLocaleDateString()}
                </span>
              </div>
            </div>

            <div style={{
              fontSize: '10px', color: 'var(--amber)', lineHeight: '1.7',
              padding: '9px 11px', background: 'rgba(255,170,0,0.06)',
              border: '1px solid rgba(255,170,0,0.25)', borderRadius: 'var(--radius)',
            }}>
              Shown once. Only an HMAC of it is stored, so nothing — Rāma
              included — can reproduce it later.
            </div>

            <ErrorBox>{error}</ErrorBox>

            <button className="btn btn-primary" onClick={continueFromIssued}
              style={{ justifyContent: 'center', padding: '10px' }}>
              I saved it — continue →
            </button>
          </div>
        )}

        {/* ── Recovery ───────────────────────────────────────────────────── */}
        {phase === PHASES.RECOVER && (
          <form onSubmit={recover} style={{ display: 'flex', flexDirection: 'column', gap: '13px' }}>
            <div style={{ fontSize: '10px', color: 'var(--muted)', lineHeight: '1.7' }}>
              Your password alone can mint a replacement key. The new key is valid
              for 7 days, and the old one stops working immediately.
            </div>

            <Field label="USERNAME">
              <input className="input" value={username} autoFocus autoComplete="username"
                onChange={e => { setUsername(e.target.value.toLowerCase()); setError(''); }} />
            </Field>

            <Field label="PASSWORD">
              <input className="input" type="password" value={password} autoComplete="current-password"
                onChange={e => { setPassword(e.target.value); setError(''); }} />
            </Field>

            <ErrorBox>{error}</ErrorBox>

            <button type="submit" className="btn btn-primary" disabled={busy}
              style={{ justifyContent: 'center', padding: '10px' }}>
              {busy ? 'Issuing...' : 'Issue a new key'}
            </button>

            <button type="button" className="btn" onClick={resetToPassword}
              style={{ justifyContent: 'center', fontSize: '10px', color: 'var(--muted)' }}>
              ← Back to sign in
            </button>
          </form>
        )}

        <div style={{ fontSize: '9px', color: 'var(--muted)', textAlign: 'center', lineHeight: '1.6' }}>
          Three independent secrets guard this instance: the store passcode, your
          password, and your access key.
        </div>
      </div>
    </div>
  );
}
