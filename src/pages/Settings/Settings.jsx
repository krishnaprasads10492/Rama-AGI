import React, { useState, useEffect, useCallback } from 'react';
import { useRamaStore } from '@store/ramaStore.js';
import { useUserStore } from '@store/userStore.js';
import { getFingerprint } from '@services/authClient.js';

const isElectron = typeof window !== 'undefined' && !!window.rama;

/**
 * Settings — App configuration page.
 * AI providers, appearance, system, vault, auto-start, passcode change.
 */

function SettingRow({ label, desc, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '12px 0', borderBottom: '1px solid var(--border)', gap: 16 }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{label}</div>
        {desc && <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2, lineHeight: 1.5 }}>{desc}</div>}
      </div>
      <div style={{ flexShrink: 0 }}>{children}</div>
    </div>
  );
}

function Toggle({ value, onChange }) {
  return (
    <div onClick={() => onChange(!value)} style={{
      width: 40, height: 22, borderRadius: 11,
      background: value ? 'var(--violet)' : 'var(--border)',
      cursor: 'pointer', position: 'relative',
      transition: 'background 0.2s',
      boxShadow: value ? 'var(--glow-violet)' : 'none',
    }}>
      <div style={{
        position: 'absolute', top: 3, left: value ? 21 : 3,
        width: 16, height: 16, borderRadius: '50%', background: '#fff',
        transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
      }} />
    </div>
  );
}

export default function Settings() {
  const { provider, model, setProvider, setModel } = useRamaStore();
  const { currentUser, sessionToken, canDo } = useUserStore();

  const [tab,          setTab]          = useState('ai');
  const [autoStart,    setAutoStart]    = useState(false);
  const [vaultStatus,  setVaultStatus]  = useState(null);
  const [oldPasscode,  setOldPasscode]  = useState('');
  const [newPasscode,  setNewPasscode]  = useState('');
  const [confirmNew,   setConfirmNew]   = useState('');
  const [passMsg,      setPassMsg]      = useState('');
  const [appVersion,   setAppVersion]   = useState('1.0.0');
  const [isPackaged,   setIsPackaged]   = useState(false);

  useEffect(() => {
    if (!isElectron) return;
    // Load auto-start state
    window.rama.appControl?.getLoginItem?.().then(r => {
      if (r?.ok) setAutoStart(r.openAtLogin);
    });
    // Vault status
    window.rama.vault.status().then(r => {
      if (r?.ok) setVaultStatus(r);
    });
    // Version
    const v = window.rama.appControl?.getVersion?.() || '1.0.0';
    setAppVersion(v);
    setIsPackaged(window.rama.appControl?.isPackaged?.() ?? false);
  }, []);

  const toggleAutoStart = async (val) => {
    setAutoStart(val);
    if (isElectron) {
      await window.rama.appControl?.setLoginItem?.(val);
    }
  };

  const changePasscode = async () => {
    if (!newPasscode.trim() || newPasscode !== confirmNew) {
      setPassMsg('New passcodes do not match');
      return;
    }
    if (newPasscode.length < 10) {
      setPassMsg('New passcode must be at least 10 characters');
      return;
    }
    if (!isElectron) { setPassMsg('Passcode change requires Electron runtime'); return; }

    setPassMsg('Re-encrypting every domain under the new passcode...');

    // Authorised by the signed-in Master session, not by the store being open
    const res = await window.rama.session.changePasscode({
      token:       sessionToken,
      fingerprint: getFingerprint(),
      oldPasscode,
      newPasscode,
    });

    if (res?.ok) {
      setPassMsg('✓ Passcode changed — all data re-encrypted under the new key');
      setOldPasscode(''); setNewPasscode(''); setConfirmNew('');
    } else {
      setPassMsg(`✕ ${res?.error || 'Failed'}`);
    }
  };

  const PROVIDERS = ['openai', 'anthropic', 'gemini', 'groq', 'mistral', 'ollama'];
  const MODELS = {
    openai:    ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'],
    anthropic: ['claude-3-5-sonnet', 'claude-3-haiku'],
    gemini:    ['gemini-1.5-pro', 'gemini-1.5-flash'],
    groq:      ['llama-3.1-70b-groq', 'mixtral-8x7b'],
    mistral:   ['mistral-large', 'mistral-medium'],
    ollama:    ['llama3.2', 'codellama', 'phi3', 'mistral'],
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', background: 'var(--surface)',
        display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <span style={{ fontSize: 18 }}>⚙</span>
        <div style={{ fontWeight: 700, color: 'var(--accent)', letterSpacing: '0.1em' }}>SETTINGS</div>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 10, color: 'var(--muted)' }}>
          Rāma AGI v{appVersion} · {isPackaged ? 'Packaged' : 'Dev mode'}
        </span>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', background: 'var(--surface)', flexShrink: 0 }}>
        {['ai', 'system', 'security', 'about'].map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: '9px 18px', border: 'none', background: 'transparent',
            color: tab === t ? 'var(--accent)' : 'var(--muted)',
            borderBottom: tab === t ? '2px solid var(--accent)' : '2px solid transparent',
            cursor: 'pointer', fontFamily: 'var(--font)', fontSize: '11px', textTransform: 'uppercase',
          }}>{t}</button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '20px', minHeight: 0 }}>

        {/* ── AI Settings ── */}
        {tab === 'ai' && (
          <div className="hud-card" style={{ padding: '16px 20px', maxWidth: 560 }}>
            <div className="section-label" style={{ marginBottom: 14 }}>AI PROVIDER</div>

            <SettingRow label="Primary Provider" desc="Which AI service to use by default">
              <select value={provider} onChange={e => setProvider(e.target.value)}
                style={{ background: 'var(--elevated)', border: '1px solid var(--border)',
                  color: 'var(--accent)', fontFamily: 'var(--font)', fontSize: 11,
                  padding: '6px 10px', borderRadius: 'var(--radius)', outline: 'none', cursor: 'pointer' }}>
                {PROVIDERS.map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
              </select>
            </SettingRow>

            <SettingRow label="Default Model" desc="Model used for general conversation">
              <select value={model} onChange={e => setModel(e.target.value)}
                style={{ background: 'var(--elevated)', border: '1px solid var(--border)',
                  color: 'var(--accent)', fontFamily: 'var(--font)', fontSize: 11,
                  padding: '6px 10px', borderRadius: 'var(--radius)', outline: 'none', cursor: 'pointer' }}>
                {(MODELS[provider] || []).map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </SettingRow>

            <div style={{ marginTop: 14, fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.7,
              padding: '10px 12px', background: 'var(--surface)', borderRadius: 'var(--radius)',
              border: '1px solid var(--border)' }}>
              API keys are stored encrypted in your local vault.<br />
              Go to <span style={{ color: 'var(--accent)' }}>Models → Keys</span> to add or update API keys.
            </div>
          </div>
        )}

        {/* ── System Settings ── */}
        {tab === 'system' && (
          <div className="hud-card" style={{ padding: '16px 20px', maxWidth: 560 }}>
            <div className="section-label" style={{ marginBottom: 14 }}>SYSTEM</div>

            <SettingRow
              label="Start with Windows"
              desc="Launch Rāma AGI automatically when you log into Windows. Opens silently in system tray.">
              <Toggle value={autoStart} onChange={toggleAutoStart} />
            </SettingRow>

            <SettingRow
              label="Minimize to tray"
              desc="Closing the window keeps Rāma running in the system tray (always-on)">
              <Toggle value={true} onChange={() => {}} />
            </SettingRow>

            <SettingRow
              label="Voice wake word"
              desc='"Hey Rāma" — passive listening for voice commands'>
              <Toggle value={true} onChange={() => {}} />
            </SettingRow>
          </div>
        )}

        {/* ── Security Settings ── */}
        {tab === 'security' && (
          <div style={{ maxWidth: 560, display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Vault status */}
            <div className="hud-card" style={{ padding: '16px 20px' }}>
              <div className="section-label" style={{ marginBottom: 14 }}>VAULT STATUS</div>
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                {[
                  ['Status',   vaultStatus?.unlocked ? 'Unlocked' : 'Locked', vaultStatus?.unlocked ? 'var(--green)' : 'var(--red)'],
                  ['Entries',  vaultStatus?.entries ?? '?', 'var(--accent)'],
                  ['Cipher',   'AES-256-GCM', 'var(--violet)'],
                  ['KDF',      'Argon2id', 'var(--violet)'],
                  ['Integrity','HMAC-SHA512', 'var(--green)'],
                ].map(([k, v, c]) => (
                  <div key={k} style={{ textAlign: 'center', padding: '8px 14px',
                    background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: c }}>{v}</div>
                    <div style={{ fontSize: 9, color: 'var(--muted)', marginTop: 2 }}>{k}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Change passcode */}
            {canDo('vault.write') && (
              <div className="hud-card" style={{ padding: '16px 20px' }}>
                <div className="section-label" style={{ marginBottom: 14 }}>CHANGE MASTER PASSCODE</div>
                {[
                  { label: 'Current passcode',  value: oldPasscode, set: setOldPasscode },
                  { label: 'New passcode',       value: newPasscode, set: setNewPasscode },
                  { label: 'Confirm new passcode', value: confirmNew, set: setConfirmNew },
                ].map(f => (
                  <div key={f.label} style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 4 }}>{f.label.toUpperCase()}</div>
                    <input className="input" type="password" value={f.value}
                      onChange={e => f.set(e.target.value)} style={{ fontSize: 12 }} />
                  </div>
                ))}
                {passMsg && (
                  <div style={{ color: passMsg.startsWith('✓') ? 'var(--green)' : 'var(--red)',
                    fontSize: 11, marginBottom: 10 }}>{passMsg}</div>
                )}
                <button className="btn btn-primary btn-sm" onClick={changePasscode}
                  style={{ width: '100%', justifyContent: 'center' }}>
                  🔒 Change Passcode
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── About ── */}
        {tab === 'about' && (
          <div className="hud-card" style={{ padding: 24, maxWidth: 480 }}>
            <div style={{ textAlign: 'center', marginBottom: 24 }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--violet)', letterSpacing: '0.12em', marginBottom: 4 }}>
                RĀMA AGI
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                Righteous Autonomous Master Agent
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>
                Version {appVersion} · {isPackaged ? 'Production Build' : 'Development Build'}
              </div>
            </div>

            {[
              ['Author',      'Krishna Prasad'],
              ['Architecture','Electron 31 + React 19 + Node.js 22'],
              ['Encryption',  'AES-256-GCM + Argon2id + HMAC-SHA512'],
              ['AI Providers','OpenAI · Anthropic · Gemini · Groq · Mistral · Ollama'],
              ['Repository',  'krishnaprasads10492/Rama-AGI'],
              ['License',     'Private — All rights reserved'],
            ].map(([k, v]) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between',
                padding: '8px 0', borderBottom: '1px solid var(--border)', fontSize: 11 }}>
                <span style={{ color: 'var(--muted)' }}>{k}</span>
                <span style={{ color: 'var(--text-dim)' }}>{v}</span>
              </div>
            ))}

            <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
              <button className="btn btn-sm" style={{ flex: 1, justifyContent: 'center' }}
                onClick={() => isElectron && window.rama.shell.openExternal('https://github.com/krishnaprasads10492/Rama-AGI')}>
                ⎇ GitHub
              </button>
              <button className="btn btn-sm" style={{ flex: 1, justifyContent: 'center' }}
                onClick={() => isElectron && window.ipcRenderer?.invoke('updater:install-now')}>
                ↺ Check Updates
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
