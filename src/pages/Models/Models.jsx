import React, { useEffect, useState, useCallback } from 'react';

const isElectron = typeof window !== 'undefined' && !!window.rama;

const PROVIDER_COLORS = {
  openai:    'var(--green)',
  anthropic: 'var(--amber)',
  gemini:    'var(--accent)',
  mistral:   'var(--violet)',
  groq:      'var(--magenta)',
  ollama:    'var(--green)',
};

const PROVIDER_LINKS = {
  OPENAI_API_KEY:    { label: 'OpenAI',    url: 'https://platform.openai.com/api-keys',            hint: 'Create account → API Keys → Create new key' },
  ANTHROPIC_API_KEY: { label: 'Anthropic', url: 'https://console.anthropic.com/keys',              hint: 'Create account → API Keys' },
  GEMINI_API_KEY:    { label: 'Gemini',    url: 'https://aistudio.google.com/app/apikey',          hint: 'Google account → AI Studio → Get API key' },
  MISTRAL_API_KEY:   { label: 'Mistral',   url: 'https://console.mistral.ai/api-keys/',            hint: 'Create account → API Keys' },
  GROQ_API_KEY:      { label: 'Groq',      url: 'https://console.groq.com/keys',                   hint: 'Create account → API Keys (free tier available)' },
  NEWSAPI_KEY:       { label: 'NewsAPI',   url: 'https://newsapi.org/register',                    hint: 'Free for developers — 100 req/day' },
  ALPHA_VANTAGE_KEY: { label: 'Alpha Vantage', url: 'https://www.alphavantage.co/support/#api-key',hint: 'Free API key for stock data' },
  GITHUB_TOKEN:      { label: 'GitHub',    url: 'https://github.com/settings/tokens',              hint: 'Settings → Developer settings → Personal access tokens' },
};

function ModelRow({ model, status, primary, onSetPrimary, onAddKey }) {
  const isAvailable = status === 'available' || status === 'local';
  const color       = PROVIDER_COLORS[model.provider] || 'var(--accent)';

  return (
    <div style={{
      display:      'flex',
      alignItems:   'center',
      gap:          '12px',
      padding:      '10px 14px',
      borderBottom: '1px solid var(--border)',
      background:   primary ? 'rgba(119,0,255,0.05)' : 'transparent',
    }}>
      {/* Online dot */}
      <div style={{
        width: '6px', height: '6px', borderRadius: '50%', flexShrink: 0,
        background: isAvailable ? 'var(--green)' : 'var(--border)',
        boxShadow:  isAvailable ? 'var(--glow-green)' : 'none',
      }} />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '12px', fontWeight: 700, color }}>{model.id}</span>
          {primary && <span className="badge badge-violet" style={{ fontSize: '9px' }}>PRIMARY</span>}
          <span style={{ fontSize: '10px', color: 'var(--muted)', marginLeft: 'auto' }}>
            {model.ctxK}k ctx
          </span>
        </div>
        <div style={{ fontSize: '10px', color: 'var(--muted)', marginTop: '2px' }}>
          {model.caps.join(' · ')} · cost tier {model.costTier === 0 ? 'FREE' : model.costTier}
        </div>
      </div>

      <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
        {!isAvailable && model.credKey && (
          <button className="btn btn-sm" onClick={() => onAddKey(model.credKey)}
            style={{ borderColor: 'var(--amber)', color: 'var(--amber)', fontSize: '10px' }}>
            + Add Key
          </button>
        )}
        {isAvailable && !primary && (
          <button className="btn btn-sm" onClick={() => onSetPrimary(model.id)}
            style={{ fontSize: '10px' }}>
            Set Primary
          </button>
        )}
      </div>
    </div>
  );
}

function AddKeyModal({ credKey, info, onSave, onClose }) {
  const [value, setValue] = useState('');
  const [busy,  setBusy]  = useState(false);

  const save = async () => {
    if (!value.trim()) return;
    setBusy(true);
    await onSave(credKey, value.trim());
    setBusy(false);
    onClose();
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 500 }}>
      <div className="hud-card" style={{ width: '480px', padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ fontWeight: 700, color: 'var(--accent)' }}>ADD {info?.label?.toUpperCase()} API KEY</span>
          <button className="btn btn-sm" onClick={onClose}>✕</button>
        </div>

        <div style={{ background: 'rgba(0,255,255,0.05)', border: '1px solid rgba(0,255,255,0.2)',
          borderRadius: 'var(--radius)', padding: '12px', fontSize: '12px', color: 'var(--text-dim)', lineHeight: '1.7' }}>
          <div style={{ color: 'var(--accent)', fontWeight: 700, marginBottom: '4px' }}>How to get this key:</div>
          {info?.hint}<br />
          <button className="btn btn-sm" style={{ marginTop: '8px' }}
            onClick={() => isElectron && window.rama.shell.openExternal(info?.url)}>
            🌐 Open {info?.url}
          </button>
        </div>

        <div>
          <div className="section-label" style={{ marginBottom: '6px' }}>PASTE YOUR KEY</div>
          <input className="input" type="password" placeholder={`${credKey}...`}
            value={value} onChange={e => setValue(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && save()} />
          <div style={{ fontSize: '10px', color: 'var(--muted)', marginTop: '4px' }}>
            Stored AES-256-GCM encrypted in your local vault. Never leaves this machine.
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <button className="btn btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn btn-sm btn-primary" disabled={!value.trim() || busy} onClick={save}>
            {busy ? 'Saving...' : '🔒 Save Encrypted'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Models() {
  const [models,      setModels]      = useState([]);
  const [credentials, setCredentials] = useState({});
  const [primary,     setPrimary]     = useState('gpt-4o');
  const [ollamaModels,setOllamaModels]= useState([]);
  const [addKeyFor,   setAddKeyFor]   = useState(null);
  const [pullName,    setPullName]    = useState('');
  const [pulling,     setPulling]     = useState(false);
  const [vaultLocked, setVaultLocked] = useState(true);
  const [password,    setPassword]    = useState('');
  const [tab,         setTab]         = useState('cloud');

  const load = useCallback(async () => {
    if (!isElectron) return;
    const [mRes, pRes, vRes] = await Promise.all([
      window.rama.models.list(),
      window.rama.models.getPrimary(),
      window.rama.vault.status(),
    ]);
    if (mRes.ok) { setModels(mRes.data); setOllamaModels(mRes.ollama || []); }
    if (pRes.ok) setPrimary(pRes.model);
    if (vRes.ok) setVaultLocked(!vRes.unlocked);

    const cRes = await window.rama.models.checkCredentials();
    if (cRes.ok) setCredentials(cRes.data);
  }, []);

  useEffect(() => { load(); }, [load]);

  const unlockVault = async () => {
    if (!isElectron || !password) return;
    const res = await window.rama.vault.unlock(password);
    if (res.ok) { setVaultLocked(false); setPassword(''); load(); }
  };

  const saveKey = async (credKey, value) => {
    if (!isElectron) return;
    await window.rama.vault.set(credKey, value, { label: PROVIDER_LINKS[credKey]?.label });
    load();
  };

  const setAsPrimary = async (modelId) => {
    if (!isElectron) return;
    await window.rama.models.setPrimary(modelId);
    setPrimary(modelId);
  };

  const pullOllama = async () => {
    if (!pullName.trim() || !isElectron) return;
    setPulling(true);
    await window.rama.models.ollamaPull(pullName, (data) => {
      // Progress updates handled via event
    });
    setPulling(false);
    load();
  };

  const cloudModels = models.filter(m => m.type === 'cloud');
  const localModels = models.filter(m => m.type === 'local');

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {addKeyFor && (
        <AddKeyModal
          credKey={addKeyFor}
          info={PROVIDER_LINKS[addKeyFor]}
          onSave={saveKey}
          onClose={() => setAddKeyFor(null)}
        />
      )}

      {/* Header */}
      <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', background: 'var(--surface)',
        display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
        <span style={{ fontWeight: 700, color: 'var(--accent)', letterSpacing: '0.1em' }}>AI MODEL ROUTER</span>
        <span className="badge badge-cyan">MULTI-MODEL</span>
        <span className="badge badge-violet">PRIMARY: {primary}</span>
        <div style={{ flex: 1 }} />
        <button className="btn btn-sm" onClick={load}>↺ Refresh</button>
      </div>

      {/* Vault unlock prompt */}
      {vaultLocked && (
        <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border)',
          background: 'rgba(255,170,0,0.05)', display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
          <span style={{ fontSize: '11px', color: 'var(--amber)' }}>🔒 Vault locked — unlock to use API keys</span>
          <input className="input" type="password" placeholder="Master password" value={password}
            onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === 'Enter' && unlockVault()}
            style={{ width: '200px', fontSize: '11px' }} />
          <button className="btn btn-sm btn-primary" onClick={unlockVault}>Unlock</button>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', background: 'var(--surface)', flexShrink: 0 }}>
        {['cloud', 'local', 'keys'].map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: '9px 18px', border: 'none', background: 'transparent',
            color: tab === t ? 'var(--accent)' : 'var(--muted)',
            borderBottom: tab === t ? '2px solid var(--accent)' : '2px solid transparent',
            cursor: 'pointer', fontFamily: 'var(--font)', fontSize: '11px', textTransform: 'uppercase',
          }}>{t}</button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '20px', minHeight: 0 }}>
        {tab === 'cloud' && (
          <div className="hud-card" style={{ overflow: 'hidden' }}>
            {cloudModels.map(m => (
              <ModelRow key={m.id} model={m} status={credentials[m.id]}
                primary={m.id === primary}
                onSetPrimary={setAsPrimary}
                onAddKey={setAddKeyFor} />
            ))}
          </div>
        )}

        {tab === 'local' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div className="hud-card" style={{ overflow: 'hidden' }}>
              <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
                <div className="section-label">OLLAMA LOCAL MODELS</div>
                <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '4px' }}>
                  {ollamaModels.length} models detected · Ollama must be running at localhost:11434
                </div>
              </div>
              {localModels.map(m => (
                <ModelRow key={m.id} model={m} status={credentials[m.id]}
                  primary={m.id === primary}
                  onSetPrimary={setAsPrimary}
                  onAddKey={setAddKeyFor} />
              ))}
              {ollamaModels.length === 0 && (
                <div style={{ padding: '20px', color: 'var(--muted)', textAlign: 'center', fontSize: '12px' }}>
                  No Ollama models detected. Install Ollama and pull models below.
                </div>
              )}
            </div>

            <div className="hud-card" style={{ padding: '16px' }}>
              <div className="section-label" style={{ marginBottom: '10px' }}>PULL NEW OLLAMA MODEL</div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input className="input" placeholder="e.g. llama3.2, codellama, mistral, phi3"
                  value={pullName} onChange={e => setPullName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && pullOllama()} />
                <button className="btn btn-primary" disabled={pulling || !pullName.trim()} onClick={pullOllama}
                  style={{ flexShrink: 0 }}>
                  {pulling ? 'Pulling...' : '⬇ Pull'}
                </button>
              </div>
              <div style={{ fontSize: '10px', color: 'var(--muted)', marginTop: '6px' }}>
                Browse available models at{' '}
                <span style={{ color: 'var(--accent)', cursor: 'pointer' }}
                  onClick={() => isElectron && window.rama.shell.openExternal('https://ollama.com/library')}>
                  ollama.com/library
                </span>
              </div>
            </div>
          </div>
        )}

        {tab === 'keys' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {Object.entries(PROVIDER_LINKS).map(([key, info]) => {
              const has = credentials[key.toLowerCase()] === 'available' ||
                          Object.values(credentials).find((_, i) => Object.keys(credentials)[i] === key);
              return (
                <div key={key} className="hud-card" style={{ padding: '14px 16px',
                  display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{ width: '6px', height: '6px', borderRadius: '50%', flexShrink: 0,
                    background: 'var(--border)' }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: '12px', color: 'var(--text)' }}>{info.label}</div>
                    <div style={{ fontSize: '10px', color: 'var(--muted)', marginTop: '2px' }}>{info.hint}</div>
                  </div>
                  <button className="btn btn-sm btn-primary"
                    onClick={() => vaultLocked ? alert('Unlock vault first') : setAddKeyFor(key)}>
                    {vaultLocked ? '🔒 Vault Locked' : '+ Add / Update Key'}
                  </button>
                  <button className="btn btn-sm"
                    onClick={() => isElectron && window.rama.shell.openExternal(info.url)}>
                    🌐 Get Key
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
