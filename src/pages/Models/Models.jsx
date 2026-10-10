import React, { useEffect, useState, useCallback } from 'react';
import { useUserStore } from '@store/userStore.js';
import { FS, LH } from '@config/type.js';

const isElectron = typeof window !== 'undefined' && !!window.rama;

const PROVIDER_COLORS = {
  openai:          'var(--green)',
  anthropic:       'var(--amber)',
  gemini:          'var(--accent)',
  mistral:         'var(--violet)',
  groq:            'var(--magenta)',
  ollama:          'var(--green)',
  // The KEYED cloud path. A different colour from `ollama` on purpose: the two are different
  // transports with different costs, and the id prefix is the only other thing that says so.
  'ollama-cloud':  'var(--cyan)',
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
  OLLAMA_API_KEY:    { label: 'Ollama Cloud', url: 'https://ollama.com/settings/keys',             hint: 'Create a key named Rama → paste here. No Ollama install needed for cloud models.' },
};

/**
 * `cloudStatus` is the whole reason this component takes a third state.
 *
 * `checkAvailable` ends `!!getCredential(credKey)` and `getCredential` returns null while the vault
 * is LOCKED, so `credentialStatus()` maps every unavailable non-local row to 'missing-key'. Without
 * the branch below, master — who has already given Rāma the key — is shown an Add-key button and
 * invited to re-paste a credential Rāma already holds. Locked is not absent, at any layer.
 */
export function vaultLockedWithStoredKey(cloudStatus, model) {
  return cloudStatus?.vaultUnlocked === false && model?.provider === 'ollama-cloud';
}

function ModelRow({ model, status, primary, onSetPrimary, onAddKey, cloudStatus }) {
  // 'available' for a local model means Ollama actually reported it. This used to also accept
  // 'local', which meant only "needs no API key" — so every Ollama model in the registry rendered
  // as ready on machines with no Ollama installed (Section 88).
  const isAvailable = status === 'available';
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
          {primary && <span className="badge badge-violet" style={{ fontSize: FS.chrome, lineHeight: LH.chrome }}>PRIMARY</span>}
          <span style={{ fontSize: FS.chrome, lineHeight: LH.chrome, color: 'var(--muted)', marginLeft: 'auto' }}>
            {model.ctxK}k ctx
          </span>
        </div>
        <div style={{ fontSize: FS.chrome, lineHeight: LH.chrome, color: 'var(--muted)', marginTop: '2px' }}>
          {model.caps.join(' · ')} · cost tier {model.costTier === 0 ? 'FREE' : model.costTier}
        </div>
      </div>

      <div style={{ display: 'flex', gap: '6px', flexShrink: 0, alignItems: 'center' }}>
        {/* A local model has no key to add, so without this the grey dot has no explanation. */}
        {status === 'not-installed' && (
          <span style={{ fontSize: '11.5px', color: 'var(--muted)' }}>not pulled</span>
        )}
        {!isAvailable && model.credKey && (
          vaultLockedWithStoredKey(cloudStatus, model)
            ? <span style={{ fontSize: '11.5px', color: 'var(--muted)' }}>
                vault locked — unlock to use the stored key
              </span>
            : <button className="btn btn-sm" onClick={() => onAddKey(model.credKey)}
                style={{ borderColor: 'var(--amber)', color: 'var(--amber)', fontSize: FS.chrome, lineHeight: LH.chrome }}>
                + Add Key
              </button>
        )}
        {isAvailable && !primary && (
          <button className="btn btn-sm" onClick={() => onSetPrimary(model.id)}
            style={{ fontSize: FS.chrome, lineHeight: LH.chrome }}>
            Set Primary
          </button>
        )}
      </div>
    </div>
  );
}

function AddCustomProviderModal({ onSave, onClose }) {
  const [name,      setName]      = useState('');
  const [baseUrl,   setBaseUrl]   = useState('');
  const [apiKey,    setApiKey]    = useState('');
  const [modelsStr, setModelsStr] = useState('');
  const [allowLocal, setAllowLocal] = useState(false);
  const [busy,   setBusy]   = useState(false);
  const [error,  setError]  = useState(null);

  const save = async () => {
    const models = modelsStr.split(',').map(s => s.trim()).filter(Boolean);
    if (!name.trim() || !baseUrl.trim() || models.length === 0) {
      setError('Name, base URL, and at least one model id are required.');
      return;
    }
    setBusy(true);
    setError(null);
    const res = await onSave({ name: name.trim(), baseUrl: baseUrl.trim(), apiKey: apiKey.trim() || null, models, allowLocal });
    setBusy(false);
    if (res?.ok) onClose();
    else setError(res?.error || 'Failed to add provider');
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 500 }}>
      <div className="hud-card" style={{ width: '520px', maxWidth: '92vw', padding: '24px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ fontWeight: 700, color: 'var(--accent)' }}>ADD CUSTOM OPENAI-COMPATIBLE PROVIDER</span>
          <button className="btn btn-sm" onClick={onClose}>✕</button>
        </div>

        <div style={{ fontSize: FS.chrome, color: 'var(--text-dim)', lineHeight: 1.7 }}>
          Works for any endpoint that speaks the OpenAI <code>/v1/chat/completions</code> shape —
          OpenRouter, Together, Fireworks, DeepSeek, a local LM Studio/vLLM server, and most
          new providers. A provider with a different API shape (Anthropic, Gemini) needs
          dedicated code, not this form.
        </div>

        <div>
          <div className="section-label" style={{ marginBottom: '6px' }}>NAME</div>
          <input className="input" placeholder="e.g. Together AI" value={name} onChange={e => setName(e.target.value)} />
        </div>

        <div>
          <div className="section-label" style={{ marginBottom: '6px' }}>BASE URL</div>
          <input className="input" placeholder="https://api.together.xyz" value={baseUrl} onChange={e => setBaseUrl(e.target.value)} />
        </div>

        <div>
          <div className="section-label" style={{ marginBottom: '6px' }}>MODEL IDS (comma-separated)</div>
          <input className="input" placeholder="meta-llama/Llama-3-70b, mistralai/Mixtral-8x7B"
            value={modelsStr} onChange={e => setModelsStr(e.target.value)} />
        </div>

        <div>
          <div className="section-label" style={{ marginBottom: '6px' }}>API KEY (optional — leave blank for a keyless local server)</div>
          <input className="input" type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} />
          <div style={{ fontSize: FS.chrome, lineHeight: LH.chrome, color: 'var(--muted)', marginTop: '4px' }}>
            Stored AES-256-GCM encrypted in your local vault, same as any other provider key.
          </div>
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: FS.chrome, lineHeight: LH.chrome, color: 'var(--text-dim)', cursor: 'pointer' }}>
          <input type="checkbox" checked={allowLocal} onChange={e => setAllowLocal(e.target.checked)} />
          This is a local/private server I run myself (localhost, LAN IP, etc.)
        </label>

        {error && (
          <div style={{ fontSize: FS.chrome, lineHeight: LH.chrome, color: 'var(--red)' }}>✕ {error}</div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <button className="btn btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn btn-sm btn-primary" disabled={busy} onClick={save}>
            {busy ? 'Adding...' : '+ Add Provider'}
          </button>
        </div>
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
      <div className="hud-card" style={{ width: '480px', maxWidth: '92vw', padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
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
          <div style={{ fontSize: FS.chrome, lineHeight: LH.chrome, color: 'var(--muted)', marginTop: '4px' }}>
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
  const { currentUser } = useUserStore();
  const [models,      setModels]      = useState([]);
  const [credentials, setCredentials] = useState({});
  const [primary,     setPrimary]     = useState('gpt-4o');
  const [ollamaModels,setOllamaModels]= useState([]);
  const [addKeyFor,   setAddKeyFor]   = useState(null);
  const [pullName,    setPullName]    = useState('');
  const [pulling,     setPulling]     = useState(false);
  const [vaultLocked, setVaultLocked] = useState(true);
  const [password,    setPassword]    = useState('');
  // Why the last unlock failed, and whether one is in flight. Both exist because
  // the button previously had no failure path at all (Section 141).
  const [vaultError,  setVaultError]  = useState(null);
  const [unlocking,   setUnlocking]   = useState(false);
  // `exists` + `unreadable` from vault:status, so the banner can tell "nothing
  // stored yet" from "stored but undecryptable" instead of calling both locked.
  const [vaultState,  setVaultState]  = useState({ exists: false, unreadable: false });
  const [tab,         setTab]         = useState('cloud');
  const [customProviders,   setCustomProviders]   = useState([]);
  const [showAddCustom,     setShowAddCustom]     = useState(false);
  const [customError,       setCustomError]       = useState(null);
  const [cloudStatus,       setCloudStatus]       = useState(null);

  /**
   * `allSettled`, NOT `all` — and that is a behaviour fix, not tidying.
   *
   * With `Promise.all`, one rejected channel threw out of `load()` before any
   * `set*` ran, so the whole page kept its INITIAL state: `vaultLocked` starts
   * as `true`, which means a single unrelated IPC failure renders a permanent
   * "Vault locked" banner that no correct password can clear, because the
   * unlock's own `load()` throws again on the same channel. Six independent
   * reads now fail independently, and each one that fails says so.
   */
  const load = useCallback(async () => {
    if (!isElectron) return;
    const settled = await Promise.allSettled([
      window.rama.models.list(),
      window.rama.models.getPrimary(),
      window.rama.vault.status(),
      window.rama.models.listCustomProviders({ user: currentUser }),
      window.rama.models.cloudStatus(),
      window.rama.models.checkCredentials(),
    ]);
    const value = (i) => (settled[i].status === 'fulfilled' ? settled[i].value : null);
    const [mRes, pRes, vRes, cpRes, csRes, cRes] = [0, 1, 2, 3, 4, 5].map(value);

    if (mRes?.ok) { setModels(mRes.data); setOllamaModels(mRes.ollama || []); }
    if (pRes?.ok) setPrimary(pRes.model);
    if (vRes?.ok) {
      setVaultLocked(!vRes.unlocked);
      setVaultState({ exists: !!vRes.exists, unreadable: !!vRes.unreadable });
    }
    if (cpRes?.ok) setCustomProviders(cpRes.data);
    if (csRes?.ok) setCloudStatus(csRes);
    if (cRes?.ok) setCredentials(cRes.data);

    // A channel that REJECTED is a different fact from one that returned
    // `ok:false`, and the vault's is the one that strands this page, so it is
    // named rather than left as a blank banner.
    if (settled[2].status === 'rejected') {
      setVaultError('The vault status channel did not answer: '
        + `${settled[2].reason?.message || String(settled[2].reason)}`);
    }
  }, [currentUser]);

  useEffect(() => { load(); }, [load]);

  /**
   * A FAILED UNLOCK USED TO DO NOTHING AT ALL. The result was checked with
   * `if (res.ok)` and the else branch did not exist, so a wrong password, a
   * denied capability and an unreadable vault all looked identical to a dead
   * button — which is exactly what master reported (Section 141). The error the
   * main process already returns is now shown.
   */
  const unlockVault = async () => {
    if (!isElectron || !password) return;
    setVaultError(null);
    setUnlocking(true);
    try {
      const res = await window.rama.vault.unlock(currentUser, password);
      if (res?.ok) {
        setVaultLocked(false);
        setPassword('');
        setVaultError(null);
        load();
      } else {
        // The password is NOT cleared on failure: retyping a long passphrase
        // because the app threw it away is its own small insult.
        setVaultError(res?.error || 'The vault did not unlock, and gave no reason.');
      }
    } catch (err) {
      // A rejected invoke means the channel is missing or the main process threw.
      // Saying so beats a button that appears broken.
      setVaultError(`The vault could not be reached: ${err?.message || String(err)}`);
    } finally {
      setUnlocking(false);
    }
  };

  const saveKey = async (credKey, value) => {
    if (!isElectron) return;
    await window.rama.vault.set(currentUser, credKey, value, { label: PROVIDER_LINKS[credKey]?.label });
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
    await window.rama.models.ollamaPull({ user: currentUser, modelName: pullName }, (data) => {
      // Progress updates handled via event
    });
    setPulling(false);
    load();
  };

  const addCustomProvider = async (def) => {
    if (!isElectron) return { ok: false, error: 'Desktop app required' };
    const res = await window.rama.models.addCustomProvider({ user: currentUser, ...def });
    if (res.ok) load();
    return res;
  };

  const removeCustomProvider = async (id) => {
    if (!isElectron) return;
    setCustomError(null);
    const res = await window.rama.models.removeCustomProvider({ user: currentUser, id });
    if (!res.ok) setCustomError(res.error);
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

      {showAddCustom && (
        <AddCustomProviderModal
          onSave={addCustomProvider}
          onClose={() => setShowAddCustom(false)}
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

      {/* ── Vault unlock prompt ────────────────────────────────────────────────
             THE BANNER SAYS WHICH OF THREE THINGS IS TRUE, and says why an
             attempt failed. It previously said "Vault locked" in every case and
             reported nothing at all when Unlock did not work (Section 141).

             IT ALSO SAYS WHY IT IS ASKING. The credential vault is a SECOND
             encrypted store with its own key: `cryptoCore.cjs` opens
             `data/system` with the passcode at startup, this opens
             `rama_vault.enc`, and nothing connects the two. Master typed a
             password at launch and was asked again here with no explanation,
             which reads as a bug even though it is the design. Whether it SHOULD
             be one secret is master's call and is raised in Section 141 — until
             he decides, the screen at least stops being silent about it. */}
      {vaultLocked && (
        <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border)',
          background: 'rgba(255,170,0,0.05)', display: 'flex', alignItems: 'flex-start',
          gap: '10px', flexShrink: 0, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: FS.chrome, lineHeight: LH.chrome, color: 'var(--amber)' }}>
              {vaultState.unreadable
                ? '🔒 Vault present but not decrypted — the password did not open it'
                : vaultState.exists
                  ? '🔒 Vault locked — unlock to use the stored API keys'
                  : '🔒 No vault yet — set a master password to start one'}
            </span>
            <input className="input" type="password" placeholder="Vault master password" value={password}
              onChange={e => { setPassword(e.target.value); setVaultError(null); }}
              onKeyDown={e => e.key === 'Enter' && unlockVault()}
              aria-label="Vault master password"
              aria-invalid={!!vaultError}
              style={{ width: '220px', fontSize: FS.chrome, lineHeight: LH.chrome }} />
            <button className="btn btn-sm btn-primary" onClick={unlockVault}
              disabled={unlocking || !password}>
              {unlocking ? 'Unlocking…' : 'Unlock'}
            </button>
          </div>
          {/* No `lineHeight`: there is no `LH.micro` role, and asking for one makes
              `roleMap` warn and return undefined. The other two `FS.micro` sites
              omit it for the same reason and inherit, which is the intended fallback. */}
          <div style={{ flexBasis: '100%', fontSize: FS.micro }}>
            {vaultError
              ? <span role="alert" style={{ color: 'var(--red)' }}>{vaultError}</span>
              : <span style={{ color: 'var(--muted)' }}>
                  This is the credential vault, a separate encrypted file from the store your
                  startup passcode opens — so it has its own password, even if you chose the same one.
                </span>}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', background: 'var(--surface)', flexShrink: 0 }}>
        {['cloud', 'local', 'custom', 'keys'].map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: '9px 18px', border: 'none', background: 'transparent',
            color: tab === t ? 'var(--accent)' : 'var(--muted)',
            borderBottom: tab === t ? '2px solid var(--accent)' : '2px solid transparent',
            cursor: 'pointer', fontFamily: 'var(--font)', fontSize: FS.chrome, lineHeight: LH.chrome, textTransform: 'uppercase',
          }}>{t}</button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '20px', minHeight: 0 }}>
        {tab === 'cloud' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {/* THREE STATES, NEVER TWO. "no key stored" and "vault locked" mean opposite things:
                one needs a key, the other needs a password Rāma will not ask for twice. */}
            <div className="hud-card" style={{ padding: '10px 14px', fontSize: FS.chrome, lineHeight: LH.chrome }}>
              <span style={{ color: 'var(--muted)', letterSpacing: '0.08em' }}>OLLAMA CLOUD — </span>
              {cloudStatus?.present
                ? <span style={{ color: 'var(--green)' }}>key PRESENT ({cloudStatus.source})</span>
                : cloudStatus?.vaultUnlocked === false
                  ? <span style={{ color: 'var(--amber)' }}>vault locked — unlock to use the stored key</span>
                  : <span style={{ color: 'var(--amber)' }}>key ABSENT — add a key to use cloud models</span>}
              {cloudStatus?.baseUrlOverrideRejected && (
                <span style={{ color: 'var(--red)', marginLeft: '8px' }}>
                  base URL override rejected — using the default
                </span>
              )}
              <div style={{ color: 'var(--muted)', marginTop: '4px', fontSize: FS.chrome, lineHeight: LH.chrome }}>
                {cloudStatus?.baseUrl || 'https://ollama.com'} · cloud models need no Ollama install
              </div>
            </div>

            <div className="hud-card" style={{ overflow: 'hidden' }}>
              {cloudModels.map(m => (
                <ModelRow key={m.id} model={m} status={credentials[m.id]}
                  primary={m.id === primary}
                  onSetPrimary={setAsPrimary}
                  onAddKey={setAddKeyFor}
                  cloudStatus={cloudStatus} />
              ))}
            </div>
          </div>
        )}

        {tab === 'local' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div className="hud-card" style={{ overflow: 'hidden' }}>
              <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
                <div className="section-label">OLLAMA LOCAL MODELS</div>
                {/* A master with no daemon is told the way forward at the point he discovers the
                    problem, rather than having to find the cloud tab himself. */}
                <div style={{ fontSize: FS.chrome, lineHeight: LH.chrome, color: 'var(--muted)', marginTop: '4px' }}>
                  {ollamaModels.length} models detected · Ollama must be running at localhost:11434
                  {' '}— or add an Ollama Cloud key to use cloud models with no install
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
              <div style={{ fontSize: FS.chrome, lineHeight: LH.chrome, color: 'var(--muted)', marginTop: '6px' }}>
                Browse available models at{' '}
                <span style={{ color: 'var(--accent)', cursor: 'pointer' }}
                  onClick={() => isElectron && window.rama.shell.openExternal('https://ollama.com/library')}>
                  ollama.com/library
                </span>
              </div>
            </div>
          </div>
        )}

        {tab === 'custom' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div className="hud-card" style={{ padding: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
                <div className="section-label">CUSTOM OPENAI-COMPATIBLE PROVIDERS</div>
                <div style={{ flex: 1 }} />
                <button className="btn btn-sm btn-primary" onClick={() => setShowAddCustom(true)}>
                  + Add Provider
                </button>
              </div>
              <div style={{ fontSize: FS.chrome, color: 'var(--text-dim)', lineHeight: 1.7 }}>
                Add any endpoint that speaks the OpenAI <code>/v1/chat/completions</code> shape —
                covers most current and future LLM hosts without a code change. Once added,
                these models participate in the same routing, fallback, and rate-limit logic
                as every built-in provider.
              </div>
              {customError && (
                <div style={{ marginTop: 8, fontSize: FS.chrome, lineHeight: LH.chrome, color: 'var(--red)' }}>✕ {customError}</div>
              )}
            </div>

            {customProviders.length === 0 ? (
              <div style={{ color: 'var(--muted)', fontSize: '12px', padding: '12px' }}>
                No custom providers added yet.
              </div>
            ) : (
              <div className="hud-card" style={{ overflow: 'hidden' }}>
                {customProviders.map(p => (
                  <div key={p.id} style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)',
                    display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text)' }}>
                        {p.name} {p.hasKey && <span style={{ fontSize: FS.chrome, lineHeight: LH.chrome, color: 'var(--green)' }}>🔒 keyed</span>}
                      </div>
                      <div style={{ fontSize: FS.chrome, lineHeight: LH.chrome, color: 'var(--muted)', marginTop: '2px' }}>{p.baseUrl}</div>
                      <div style={{ fontSize: FS.chrome, lineHeight: LH.chrome, color: 'var(--text-dim)', marginTop: '2px' }}>
                        {p.models.join(', ')}
                      </div>
                    </div>
                    <button className="btn btn-sm btn-danger" onClick={() => removeCustomProvider(p.id)}>
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
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
                    <div style={{ fontSize: FS.chrome, lineHeight: LH.chrome, color: 'var(--muted)', marginTop: '2px' }}>{info.hint}</div>
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
