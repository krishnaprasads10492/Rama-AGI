import React, { useEffect, useState } from 'react';

/**
 * NewProject — create a project that Rāma already knows about (spec Section 86).
 *
 * Master's point was not "add a scaffolder". It was that creating something should not require then
 * telling Rāma it exists. So the creation call ends by registering the project itself, and this
 * dialog closes by handing the path straight to the file tree. There is no step where he points
 * Rāma at what Rāma just made.
 *
 * The templates are deliberately small and runnable rather than large skeletons of placeholder
 * files. A scaffold full of TODOs looks like progress and is not (I12).
 */
export default function NewProject({ currentUser, onCreated, onClose }) {
  const [templates, setTemplates] = useState([]);
  const [template, setTemplate] = useState('node-cli');
  const [name, setName] = useState('');
  const [parentDir, setParentDir] = useState('');
  const [git, setGit] = useState(true);
  const [force, setForce] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [log, setLog] = useState('');

  const live = typeof window !== 'undefined' && !!window.rama?.workspace;

  useEffect(() => {
    if (!live) return undefined;
    window.rama.workspace.templates({ user: currentUser }).then((r) => {
      if (r?.ok !== false && Array.isArray(r.data)) setTemplates(r.data);
    }).catch(() => {});
    const off = window.rama.workspace.onLog((chunk) => setLog((s) => (s + chunk).slice(-4000)));
    return () => off?.();
  }, [live, currentUser]);

  const pickParent = async () => {
    if (!window.rama?.fs?.selectPath) return;
    const res = await window.rama.fs.selectPath({
      directory: true, title: 'Where should the project go?',
    });
    if (!res?.canceled && res?.paths?.[0]) setParentDir(res.paths[0]);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!live) return;
    setBusy(true);
    setResult(null);
    setLog('');
    const res = await window.rama.workspace.create({
      user: currentUser, parentDir, name, template, git, force,
    });
    setBusy(false);
    setResult(res);
    // Only hand the path over on success — opening a folder that was not created would be worse
    // than doing nothing.
    if (res?.ok && res.path) onCreated?.(res.path);
  };

  const chosen = templates.find((t) => t.id === template);

  return (
    <div
      role="dialog" aria-modal="true" aria-label="Create a new project"
      style={{
        position: 'fixed', inset: 0, zIndex: 400, display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        background: 'rgba(3,8,16,0.82)', backdropFilter: 'blur(3px)', padding: 24,
      }}
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose?.(); }}
    >
      <form className="hud-card" onSubmit={submit}
            style={{ width: '100%', maxWidth: 620, padding: 18, display: 'flex',
              flexDirection: 'column', gap: 12, maxHeight: '88%', overflowY: 'auto' }}>
        <div className="section-label">NEW PROJECT</div>

        <div>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--muted)', marginBottom: 4 }}>
            TEMPLATE
          </div>
          <select className="input" value={template} onChange={(e) => setTemplate(e.target.value)}>
            {templates.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
          {chosen && (
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-dim)', marginTop: 4,
              lineHeight: 1.6 }}>
              {chosen.describe}
            </div>
          )}
        </div>

        <div>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--muted)', marginBottom: 4 }}>
            NAME
          </div>
          <input className="input" required value={name} placeholder="my-project"
                 onChange={(e) => setName(e.target.value)} />
        </div>

        <div>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--muted)', marginBottom: 4 }}>
            PARENT FOLDER
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input className="input" style={{ flex: 1 }} required value={parentDir}
                   placeholder="C:\\Projects"
                   onChange={(e) => setParentDir(e.target.value)} />
            <button type="button" className="btn btn-sm" onClick={pickParent}>📁</button>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap',
          fontSize: 'var(--text-xs)', color: 'var(--text-dim)' }}>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={git} onChange={(e) => setGit(e.target.checked)} />
            git init and first commit
          </label>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
            allow a non-empty folder
          </label>
        </div>

        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--muted)', lineHeight: 1.6 }}>
          Existing files are never overwritten, with or without that box ticked — they are skipped
          and reported. Rāma will not create a project inside its own source tree.
        </div>

        {log && (
          <pre style={{ fontSize: 'var(--text-xs)', color: 'var(--text-dim)',
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius)', padding: 10, maxHeight: 140, overflow: 'auto',
            whiteSpace: 'pre-wrap', margin: 0 }}>{log}</pre>
        )}

        {result && (
          <div style={{ fontSize: 'var(--text-xs)', lineHeight: 1.7,
            color: result.ok ? 'var(--green)' : 'var(--red)' }}>
            {result.ok
              ? `✓ created ${result.path}${result.registered
                ? ' — Rāma now knows about it, no need to select it again' : ''}`
              : `✕ ${result.error}`}
            {result.ok && (result.skipped || []).length > 0 && (
              <div style={{ color: 'var(--gold)' }}>
                left untouched: {result.skipped.map((s) => s.file).join(', ')}
              </div>
            )}
            {result.ok && result.git && !result.git.committed && result.git.note && (
              <div style={{ color: 'var(--muted)' }}>{result.git.note}</div>
            )}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-sm" disabled={busy}
                  onClick={() => onClose?.()}>
            {result?.ok ? 'Close' : 'Cancel'}
          </button>
          <button type="submit" className="btn btn-sm btn-primary" disabled={busy || !live}>
            {busy ? 'Creating…' : 'Create'}
          </button>
        </div>
        {!live && (
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--gold)' }}>
            Creating projects needs the desktop shell.
          </div>
        )}
      </form>
    </div>
  );
}
