import React, { useCallback, useEffect, useMemo, useState } from 'react';
import RamaOrb from '@components/RamaOrb.jsx';
import { instanceApi, authApi } from '@services/authClient.js';
import { TIERS, TIER_LABELS, TIER_COLORS } from '@services/accessControl.js';

/**
 * Setup — first-run provisioning for this copy of Rāma.
 *
 * Runs entirely in the UI. Whoever receives the build never has to open the
 * source to configure their instance.
 *
 * TIER POLICY (deliberate, not incidental):
 *   Master (0) is Rāma's single principal and is not offered here. It is
 *   claimable only with the master enrolment secret, which ships with no build.
 *   Every distributed copy provisions its owner at SuperAdmin (1) by default —
 *   complete operational control of that instance, no access to master identity.
 *   The owner may choose a lower tier for themselves instead.
 */

// Tiers a distributed instance may assign to its own owner
const OWNER_TIERS = [
  {
    tier: TIERS.SUPERADMIN,
    title: 'SuperAdmin',
    tagline: 'Recommended — full control of this instance',
    grants: ['Everything below', 'Terminal & filesystem writes', 'Model API keys', 'Create and manage users'],
    withheld: ['Master identity', 'Credential vault', 'Genome changes', 'Self-modification approval'],
  },
  {
    tier: TIERS.ADMIN,
    title: 'Admin',
    tagline: 'Manage people and content, not the machine',
    grants: ['Chat, agents, intelligence', 'User management', 'Process list, file reads', 'Git commits'],
    withheld: ['Terminal', 'Filesystem writes', 'Model API keys', 'Everything SuperAdmin withholds'],
  },
  {
    tier: TIERS.OPERATOR,
    title: 'Operator',
    tagline: 'Use Rāma, change nothing about it',
    grants: ['Chat and agents', 'Research and intelligence', 'Read-only system metrics', 'Knowledge writes'],
    withheld: ['User management', 'Git commits', 'All administrative capability'],
  },
];

// ─── Password strength meter ──────────────────────────────────────────────────
function strengthOf(pw) {
  const checks = [
    { pass: pw.length >= 10,          label: '10+ characters' },
    { pass: /[A-Z]/.test(pw),         label: 'uppercase' },
    { pass: /[a-z]/.test(pw),         label: 'lowercase' },
    { pass: /[0-9]/.test(pw),         label: 'number' },
    { pass: /[^A-Za-z0-9]/.test(pw),  label: 'symbol' },
  ];
  const met = checks.filter(c => c.pass).length;
  return { checks, met, total: checks.length, ok: met === checks.length };
}

function StrengthBar({ password }) {
  const { checks, met, total } = strengthOf(password);
  if (!password) return null;

  const colour = met === total ? 'var(--green)' : met >= 3 ? 'var(--amber)' : 'var(--red)';
  return (
    <div style={{ marginTop: '6px' }}>
      <div style={{ height: '3px', background: 'var(--border)', borderRadius: '2px', overflow: 'hidden' }}>
        <div style={{ width: `${(met / total) * 100}%`, height: '100%', background: colour, transition: 'width 0.2s' }} />
      </div>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '5px' }}>
        {checks.map(c => (
          <span key={c.label} style={{ fontSize: '9px', color: c.pass ? 'var(--green)' : 'var(--muted)' }}>
            {c.pass ? '✓' : '·'} {c.label}
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Field ────────────────────────────────────────────────────────────────────
function Field({ label, hint, children }) {
  return (
    <div>
      <div className="section-label" style={{ marginBottom: '5px' }}>{label}</div>
      {children}
      {hint && <div style={{ fontSize: '9px', color: 'var(--muted)', marginTop: '4px' }}>{hint}</div>}
    </div>
  );
}

function StepDots({ step, total }) {
  return (
    <div style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
      {Array.from({ length: total }, (_, i) => (
        <div key={i} style={{
          width: i === step ? '18px' : '6px', height: '6px', borderRadius: '3px',
          background: i <= step ? 'var(--violet)' : 'var(--border)',
          transition: 'all 0.2s',
        }} />
      ))}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function Setup({ onProvisioned }) {
  const [step, setStep] = useState(0);          // 0 identity · 1 access level · 2 key handover
  const [instanceName, setInstanceName] = useState('');
  const [displayName,  setDisplayName]  = useState('');
  const [username,     setUsername]     = useState('');
  const [password,     setPassword]     = useState('');
  const [confirm,      setConfirm]      = useState('');
  const [tier,         setTier]         = useState(TIERS.SUPERADMIN);
  const [masterSecret, setMasterSecret] = useState('');
  const [showMaster,   setShowMaster]   = useState(false);
  const [busy,         setBusy]         = useState(false);
  const [error,        setError]        = useState('');
  const [result,       setResult]       = useState(null);
  const [keySaved,     setKeySaved]     = useState(false);

  useEffect(() => {
    // Suggest a name so the field is never blank on a fresh machine
    try {
      const host = window.location.hostname || 'local';
      setInstanceName(`${host}-rama`);
    } catch { setInstanceName('rama-instance'); }
  }, []);

  const pwStrength = useMemo(() => strengthOf(password), [password]);

  const identityValid =
    username.trim().length >= 4 &&
    /^[a-z0-9_.-]+$/.test(username.trim().toLowerCase()) &&
    pwStrength.ok &&
    password === confirm;

  const submit = useCallback(async () => {
    setBusy(true);
    setError('');

    const res = await instanceApi.provision({
      username: username.trim().toLowerCase(),
      password,
      displayName: displayName.trim(),
      tier,
      instanceName: instanceName.trim(),
      masterSecret: masterSecret.trim() || undefined,
    });

    setBusy(false);

    if (!res?.ok) {
      setError(res?.error || 'Provisioning failed');
      return;
    }
    setResult(res);
    setStep(2);
  }, [username, password, displayName, tier, instanceName, masterSecret]);

  const finish = useCallback(() => {
    onProvisioned?.(result);
  }, [onProvisioned, result]);

  return (
    <div className="grid-bg" style={{
      height: '100vh', width: '100vw', background: 'var(--bg)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      position: 'relative', overflow: 'auto',
    }}>
      <div style={{
        position: 'absolute', top: '15%', left: '50%', transform: 'translateX(-50%)',
        width: '620px', height: '620px', borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(119,0,255,0.08), transparent 70%)',
        pointerEvents: 'none',
      }} />

      <div className="hud-card fade-in" style={{
        width: '480px', maxWidth: '92vw', padding: '32px',
        display: 'flex', flexDirection: 'column', gap: '20px',
        position: 'relative', zIndex: 1, margin: '32px 0',
      }}>
        {/* Header */}
        <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
          <RamaOrb size={44} />
          <div>
            <div style={{ fontSize: '17px', fontWeight: 700, color: 'var(--violet)', letterSpacing: '0.12em' }}>
              RĀMA AGI · FIRST RUN
            </div>
            <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '4px' }}>
              {step === 0 && 'Create the owner account for this instance'}
              {step === 1 && 'Choose the access level for this instance'}
              {step === 2 && 'Save your access key'}
            </div>
          </div>
          <StepDots step={step} total={3} />
        </div>

        {/* ── Step 0 — identity ────────────────────────────────────────────── */}
        {step === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <Field label="INSTANCE NAME" hint="How this copy identifies itself in logs and sync">
              <input className="input" value={instanceName} maxLength={64}
                onChange={e => setInstanceName(e.target.value)} />
            </Field>

            <Field label="YOUR NAME" hint="What Rāma calls you">
              <input className="input" value={displayName} maxLength={64} placeholder="optional"
                onChange={e => setDisplayName(e.target.value)} />
            </Field>

            <Field label="USERNAME" hint="4–32 characters · letters, numbers, dot, dash, underscore">
              <input className="input" value={username} autoFocus autoComplete="off"
                onChange={e => { setUsername(e.target.value.toLowerCase()); setError(''); }} />
            </Field>

            <Field label="PASSWORD">
              <input className="input" type="password" value={password} autoComplete="new-password"
                onChange={e => { setPassword(e.target.value); setError(''); }} />
              <StrengthBar password={password} />
            </Field>

            <Field label="CONFIRM PASSWORD">
              <input className="input" type="password" value={confirm} autoComplete="new-password"
                onChange={e => { setConfirm(e.target.value); setError(''); }} />
              {confirm && password !== confirm && (
                <div style={{ fontSize: '9px', color: 'var(--red)', marginTop: '4px' }}>
                  Passwords do not match
                </div>
              )}
            </Field>

            <button className="btn btn-primary" disabled={!identityValid}
              onClick={() => { setError(''); setStep(1); }}
              style={{ justifyContent: 'center', padding: '10px' }}>
              Continue →
            </button>
          </div>
        )}

        {/* ── Step 1 — access level ────────────────────────────────────────── */}
        {step === 1 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {OWNER_TIERS.map(t => {
              const active = tier === t.tier;
              const colour = TIER_COLORS[t.tier] ?? 'var(--accent)';
              return (
                <button key={t.tier} onClick={() => setTier(t.tier)}
                  style={{
                    textAlign: 'left', padding: '12px 14px', cursor: 'pointer',
                    background: active ? `${colour}14` : 'transparent',
                    border: `1px solid ${active ? colour : 'var(--border)'}`,
                    borderRadius: 'var(--radius)', color: 'var(--text)',
                    fontFamily: 'var(--font)', transition: 'all 0.15s',
                  }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{
                      width: '10px', height: '10px', borderRadius: '50%', flexShrink: 0,
                      border: `2px solid ${active ? colour : 'var(--border)'}`,
                      background: active ? colour : 'transparent',
                    }} />
                    <span style={{ fontWeight: 700, fontSize: '12px', color: active ? colour : 'var(--text)' }}>
                      Level {t.tier} · {t.title}
                    </span>
                  </div>
                  <div style={{ fontSize: '10px', color: 'var(--muted)', margin: '4px 0 6px 18px' }}>
                    {t.tagline}
                  </div>
                  {active && (
                    <div style={{ marginLeft: '18px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                      {t.grants.map(g => (
                        <div key={g} style={{ fontSize: '9px', color: 'var(--green)' }}>✓ {g}</div>
                      ))}
                      {t.withheld.map(w => (
                        <div key={w} style={{ fontSize: '9px', color: 'var(--muted)' }}>✕ {w}</div>
                      ))}
                    </div>
                  )}
                </button>
              );
            })}

            {/* Master enrolment — present but never the default path */}
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: '12px' }}>
              {!showMaster ? (
                <button className="btn" onClick={() => setShowMaster(true)}
                  style={{ fontSize: '10px', width: '100%', justifyContent: 'center', color: 'var(--muted)' }}>
                  I hold the master enrolment secret
                </button>
              ) : (
                <Field label="MASTER ENROLMENT SECRET"
                  hint="Level 0 is Rāma's single principal. It is not distributed with any build.">
                  <input className="input" type="password" value={masterSecret}
                    onChange={e => { setMasterSecret(e.target.value); setError(''); }} />
                </Field>
              )}
            </div>

            {error && (
              <div style={{
                color: 'var(--red)', fontSize: '11px', padding: '8px 10px',
                background: 'rgba(255,0,60,0.08)', border: '1px solid rgba(255,0,60,0.3)',
                borderRadius: 'var(--radius)',
              }}>
                {error}
              </div>
            )}

            <div style={{ display: 'flex', gap: '8px' }}>
              <button className="btn" onClick={() => setStep(0)} disabled={busy}
                style={{ justifyContent: 'center', padding: '10px' }}>
                ← Back
              </button>
              <button className="btn btn-primary" onClick={submit} disabled={busy}
                style={{ flex: 1, justifyContent: 'center', padding: '10px' }}>
                {busy ? 'Provisioning...' : '⚡ Provision this instance'}
              </button>
            </div>
          </div>
        )}

        {/* ── Step 2 — key handover ────────────────────────────────────────── */}
        {step === 2 && result && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{
              padding: '10px 12px', borderRadius: 'var(--radius)',
              background: 'rgba(0,255,65,0.07)', border: '1px solid rgba(0,255,65,0.3)',
              fontSize: '11px', color: 'var(--green)',
            }}>
              Instance provisioned · {result.tierLabel} (level {result.tier})
            </div>

            <div>
              <div className="section-label" style={{ marginBottom: '6px' }}>YOUR 12-DIGIT ACCESS KEY</div>
              <div style={{
                fontFamily: 'monospace', fontSize: '22px', letterSpacing: '0.14em',
                textAlign: 'center', padding: '16px', color: 'var(--gold)',
                background: 'var(--surface)', border: '1px solid var(--border)',
                borderRadius: 'var(--radius)', userSelect: 'all',
              }}>
                {result.accessKey}
              </div>
              <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                <button className="btn btn-sm" style={{ flex: 1, justifyContent: 'center' }}
                  onClick={() => { navigator.clipboard?.writeText(result.accessKey); }}>
                  Copy
                </button>
                <span style={{ fontSize: '9px', color: 'var(--muted)', alignSelf: 'center' }}>
                  Expires {new Date(result.keyExpiresAt).toLocaleDateString()}
                </span>
              </div>
            </div>

            <div style={{
              fontSize: '10px', color: 'var(--amber)', lineHeight: '1.7',
              padding: '10px 12px', background: 'rgba(255,170,0,0.06)',
              border: '1px solid rgba(255,170,0,0.25)', borderRadius: 'var(--radius)',
            }}>
              This key is shown once. It is stored only as an HMAC, so nothing —
              including Rāma — can reproduce it. Every sign-in needs your password
              <em> and </em> this key. If you lose it you can mint a new one from
              the login screen using your password.
            </div>

            <label style={{ display: 'flex', gap: '8px', alignItems: 'center', fontSize: '11px', color: 'var(--text-dim)', cursor: 'pointer' }}>
              <input type="checkbox" checked={keySaved} onChange={e => setKeySaved(e.target.checked)} />
              I have saved this key somewhere safe
            </label>

            <button className="btn btn-primary" disabled={!keySaved} onClick={finish}
              style={{ justifyContent: 'center', padding: '10px' }}>
              Continue to sign in →
            </button>
          </div>
        )}

        {/* Footer */}
        <div style={{ fontSize: '9px', color: 'var(--muted)', textAlign: 'center', lineHeight: '1.6' }}>
          Everything you enter is written into the AES-256-GCM store that your
          passcode unlocks. No plaintext account file is ever created.
        </div>
      </div>
    </div>
  );
}
