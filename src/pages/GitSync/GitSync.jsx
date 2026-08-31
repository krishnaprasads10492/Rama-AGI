import React, { useState, useEffect, useCallback } from 'react';
import { gitClient, fsClient } from '@services/ipcClient.js';
import { useUserStore } from '@store/userStore.js';

const isElectron = typeof window !== 'undefined' && !!window.rama;

// ─── Release panel — dormant until master cuts a release (Section 39) ─────────
function ReleasePanel({ repoPath }) {
  const { currentUser, canDo } = useUserStore();
  const [state,   setState]   = useState(null);
  const [bump,    setBump]    = useState('patch');
  const [notes,   setNotes]   = useState('');
  const [busy,    setBusy]    = useState(false);
  const [result,  setResult]  = useState(null);

  const load = useCallback(async () => {
    if (!isElectron || !repoPath) return;
    const res = await window.rama.release.state(repoPath);
    if (res?.ok) setState(res.data);
  }, [repoPath]);

  useEffect(() => { load(); }, [load]);

  const canCut = canDo('release.cut');

  const cut = async (push) => {
    setBusy(true);
    setResult(null);
    const res = await window.rama.release.cut({ user: currentUser, repoPath, bump, notes, push });
    setBusy(false);
    setResult(res);
    if (res?.ok) { setNotes(''); load(); }
  };

  if (!repoPath) return null;

  return (
    <div className="hud-card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="section-label">RELEASE CHANNEL</div>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 11 }}>
        <div><span style={{ color: 'var(--muted)' }}>Current version: </span>
          <span style={{ color: 'var(--text)', fontWeight: 700 }}>{state?.version || '—'}</span></div>
        <div><span style={{ color: 'var(--muted)' }}>Last tag: </span>
          <span style={{ color: 'var(--text)' }}>{state?.lastTag || 'none'}</span></div>
        <div><span style={{ color: 'var(--muted)' }}>Commits since: </span>
          <span style={{ color: 'var(--text)' }}>{state?.commitsSinceTag ?? '—'}</span></div>
        <div><span style={{ color: 'var(--muted)' }}>CI workflow: </span>
          <span style={{ color: state?.workflowPresent ? 'var(--amber)' : 'var(--muted)' }}>
            {state?.workflowPresent ? 'present, dormant until enabled on GitHub' : 'not present'}
          </span></div>
      </div>

      {!canCut ? (
        <div style={{ fontSize: 11, color: 'var(--muted)' }}>Only master may cut a release.</div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {['patch', 'minor', 'major'].map(b => (
              <button key={b} onClick={() => setBump(b)} style={{
                padding: '4px 10px', border: `1px solid ${bump === b ? 'var(--amber)' : 'var(--border)'}`,
                borderRadius: 'var(--radius)', background: bump === b ? 'rgba(212,169,64,0.1)' : 'transparent',
                color: bump === b ? 'var(--amber)' : 'var(--muted)', cursor: 'pointer',
                fontFamily: 'var(--font)', fontSize: 10, textTransform: 'uppercase',
              }}>{b}</button>
            ))}
          </div>
          <textarea className="input" value={notes} onChange={e => setNotes(e.target.value)}
            placeholder="Release notes — what changed, why it matters"
            style={{ fontSize: 11, minHeight: 60, resize: 'vertical' }} />
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-sm" disabled={busy} onClick={() => cut(false)}>
              {busy ? '…' : 'Tag Locally'}
            </button>
            <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => cut(true)}>
              {busy ? '…' : '⬆ Tag & Push'}
            </button>
          </div>
          {result && (
            <div style={{ fontSize: 11, color: result.ok ? 'var(--green)' : 'var(--red)', lineHeight: 1.6 }}>
              {result.ok ? `✓ ${result.tag} — ${result.note}` : `✕ ${result.error}`}
            </div>
          )}
        </>
      )}

      <div style={{ fontSize: 10, color: 'var(--text-dim)', lineHeight: 1.6, fontStyle: 'italic' }}>
        Tagging and pushing is the only automated step. Building installers and publishing
        them requires a CI/CD pipeline (a dormant GitHub Actions workflow already exists at
        .github/workflows/release.yml) — enabling it and configuring code signing are
        deliberately separate, explicit steps master takes when ready to make this universal.
      </div>
    </div>
  );
}

// ─── Local update panel — master's own local CI/CD (Section 40) ──────────────
function LocalUpdatePanel({ repoPath }) {
  const { currentUser, canDo } = useUserStore();
  const [state,   setState]   = useState(null);
  const [busy,    setBusy]    = useState(false);
  const [result,  setResult]  = useState(null);
  const [log,     setLog]     = useState('');
  const [backendMsg, setBackendMsg] = useState(null);

  const canUpdate = canDo('system.self-update');

  const load = useCallback(async () => {
    if (!isElectron || !repoPath) return;
    const res = await window.rama.update.check(repoPath);
    if (res?.ok) setState(res.data);
  }, [repoPath]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!isElectron) return;
    const unsub = window.rama.update.onLog((chunk) => setLog(s => (s + chunk).slice(-8000)));
    return () => unsub?.();
  }, []);

  const pullBuild = async (force) => {
    setBusy(true);
    setResult(null);
    setLog('');
    const res = await window.rama.update.pullBuild({ user: currentUser, repoPath, force });
    setBusy(false);
    setResult(res);
    if (res?.ok) load();
  };

  const restartBackend = async () => {
    setBackendMsg(null);
    const res = await window.rama.update.restartBackend({ user: currentUser });
    setBackendMsg(res);
  };

  const applyNow = async () => {
    if (result?.requiresAppRestart) {
      await window.rama.update.restartApp({ user: currentUser });
    } else if (result?.requiresWindowReload) {
      await window.rama.update.reloadWindow({ user: currentUser });
    }
  };

  if (!repoPath) return null;

  return (
    <div className="hud-card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="section-label">LOCAL SELF-UPDATE</div>
      <div style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.6 }}>
        Pulls the tracked branch on this machine, installs dependencies only if
        package.json changed, rebuilds the renderer only if src/shared changed, and
        respawns the Python engine only if ai_backend changed.
        Nothing here runs on GitHub — this is local to this install.
      </div>

      {/* A packaged install cannot be self-updated. Saying so beats leaving master to infer it
          from a raw git error (Section 80). */}
      {(state?.packaged || result?.packaged
        || (state && state.updatesRunningInstance === false)) && (
        <div style={{
          padding: '10px 12px', borderRadius: 'var(--radius)', fontSize: 11, lineHeight: 1.7,
          background: 'rgba(255,170,0,0.06)', border: '1px solid rgba(255,170,0,0.3)',
          color: 'var(--amber)',
        }}>
          {(state?.guidance || result?.guidance)}
          {(state?.packaged || result?.packaged) && (
            <pre style={{
              margin: '8px 0 0', fontSize: 10, color: 'var(--text-dim)',
              whiteSpace: 'pre-wrap',
            }}>{'git pull\nnpm install\nnpm run package:win'}</pre>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 11 }}>
        <div><span style={{ color: 'var(--muted)' }}>Branch: </span>
          <span style={{ color: 'var(--text)' }}>{state?.branch || '—'}</span></div>
        <div><span style={{ color: 'var(--muted)' }}>Behind: </span>
          <span style={{ color: state?.behind > 0 ? 'var(--amber)' : 'var(--green)' }}>
            {state?.behind ?? '—'} commit(s)
          </span></div>
        <div><span style={{ color: 'var(--muted)' }}>Working tree: </span>
          <span style={{ color: state?.isClean ? 'var(--green)' : 'var(--red)' }}>
            {state ? (state.isClean ? 'clean' : 'dirty') : '—'}
          </span></div>
      </div>

      {state?.commits?.length > 0 && (
        <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>
          {state.commits.slice(0, 5).map(c => (
            <div key={c.hash} style={{ padding: '2px 0' }}>
              <span style={{ color: 'var(--accent)' }}>{c.hash}</span> {c.message}
            </div>
          ))}
        </div>
      )}

      {!canUpdate ? (
        <div style={{ fontSize: 11, color: 'var(--muted)' }}>Only master may trigger a local update.</div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-sm btn-primary" disabled={busy || state?.upToDate}
              onClick={() => pullBuild(false)}>
              {busy ? '…' : '⬇ Pull, Install & Build'}
            </button>
            {result?.dirty && (
              <button className="btn btn-sm btn-danger" disabled={busy} onClick={() => pullBuild(true)}>
                Force (discard local edits' protection)
              </button>
            )}
          </div>

          {log && (
            <pre style={{ fontSize: 10, color: 'var(--text-dim)', background: 'var(--surface)',
              border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 10,
              maxHeight: 160, overflow: 'auto', whiteSpace: 'pre-wrap' }}>{log}</pre>
          )}

          {result && (
            <div style={{ fontSize: 11, color: result.ok ? 'var(--green)' : 'var(--red)', lineHeight: 1.6 }}>
              {result.ok
                ? (result.changed
                    ? `✓ Updated ${result.fromHead?.slice(0,7)} → ${result.toHead?.slice(0,7)} — domains: ${result.domains.join(', ') || 'none'}`
                    : '✓ Already up to date')
                : `✕ ${result.error}`}
            </div>
          )}

          {result?.ok && result.changed && result.outcome && (
            <div style={{ fontSize: 10.5, color: 'var(--text-dim)', lineHeight: 1.6 }}>
              {result.outcome}
              {result.pipSkippedReason && ` (${result.pipSkippedReason})`}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {result?.ok && result.changed
              && (result.requiresAppRestart || result.requiresWindowReload) && (
              <button className="btn btn-sm" onClick={applyNow}>
                {result.requiresAppRestart ? '↻ Restart App to Apply' : '↻ Reload Window to Apply'}
              </button>
            )}
            {/* Engine-only change: respawn the backend without losing the window. */}
            {result?.ok && result.changed && result.requiresBackendRestart && (
              <button className="btn btn-sm" disabled={busy} onClick={restartBackend}>
                ↻ Respawn Python Engine
              </button>
            )}
          </div>
          {backendMsg && (
            <div style={{ fontSize: 10.5, color: backendMsg.ok ? 'var(--green)' : 'var(--red)' }}>
              {backendMsg.ok ? `✓ ${backendMsg.message}` : `✕ ${backendMsg.error}`}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function GitSync() {
  const { currentUser } = useUserStore();
  const [repoPath,  setRepoPath]  = useState('');
  const [status,    setStatus]    = useState(null);
  const [log,       setLog]       = useState([]);
  const [diff,      setDiff]      = useState('');
  const [loading,   setLoading]   = useState(false);
  const [msg,       setMsg]       = useState('');
  const [tab,       setTab]       = useState('status');
  const [feedback,  setFeedback]  = useState('');

  const loadRepo = useCallback(async (path) => {
    if (!path) return;
    setLoading(true);
    const [sRes, lRes, dRes] = await Promise.all([
      gitClient.status(currentUser, path),
      gitClient.log(currentUser, path, 30),
      gitClient.diff(currentUser, path),
    ]);
    if (sRes.ok) setStatus(sRes.data);
    if (lRes.ok) setLog(lRes.data);
    if (dRes.ok) setDiff(dRes.data);
    setLoading(false);
  }, [currentUser]);

  const pickRepo = async () => {
    const res = await fsClient.selectPath({ directory: true, title: 'Select Git Repository' });
    if (!res.canceled && res.paths[0]) {
      setRepoPath(res.paths[0]);
      loadRepo(res.paths[0]);
    }
  };

  const stageAll = async () => {
    setFeedback('Staging all files...');
    const res = await gitClient.stage(currentUser, repoPath, []);
    if (res.ok) { setFeedback('Staged.'); loadRepo(repoPath); }
    else setFeedback(`Error: ${res.error}`);
  };

  const commit = async () => {
    if (!msg.trim()) { setFeedback('Enter a commit message.'); return; }
    setFeedback('Committing...');
    const res = await gitClient.commit(currentUser, repoPath, msg);
    if (res.ok) { setMsg(''); setFeedback('Committed.'); loadRepo(repoPath); }
    else setFeedback(`Error: ${res.error}`);
  };

  const push = async () => {
    setFeedback('Pushing...');
    const res = await gitClient.push(currentUser, repoPath, status?.branch);
    if (res.ok) { setFeedback('Pushed successfully.'); loadRepo(repoPath); }
    else setFeedback(`Error: ${res.error}`);
  };

  const pull = async () => {
    setFeedback('Pulling...');
    const res = await gitClient.pull(currentUser, repoPath);
    if (res.ok) { setFeedback('Pulled.'); loadRepo(repoPath); }
    else setFeedback(`Error: ${res.error}`);
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', background: 'var(--surface)',
        display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
        <span style={{ fontWeight: 700, color: 'var(--amber)', letterSpacing: '0.1em' }}>GIT SYNC BRIDGE</span>
        <span className="badge badge-amber">⎇ {status?.branch || 'no repo'}</span>
        {status && (
          <>
            {status.ahead > 0  && <span className="badge badge-cyan">↑ {status.ahead} ahead</span>}
            {status.behind > 0 && <span className="badge badge-red">↓ {status.behind} behind</span>}
            {status.isClean    && <span className="badge badge-green">CLEAN</span>}
          </>
        )}
        <div style={{ flex: 1 }} />
        <button className="btn btn-sm btn-primary" onClick={pickRepo}>📁 Open Repo</button>
        {repoPath && <button className="btn btn-sm" onClick={() => loadRepo(repoPath)}>↺</button>}
      </div>

      {/* Feedback bar */}
      {feedback && (
        <div style={{ padding: '6px 20px', background: 'rgba(0,255,255,0.05)', borderBottom: '1px solid var(--border)',
          color: 'var(--accent)', fontSize: '11px', flexShrink: 0 }}>
          {feedback}
        </div>
      )}

      {!repoPath ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '16px' }}>
          <span style={{ fontSize: '32px' }}>⎇</span>
          <div style={{ color: 'var(--muted)', fontSize: '12px' }}>Open a git repository to start syncing</div>
          <button className="btn btn-primary" onClick={pickRepo}>📁 Select Repository</button>
        </div>
      ) : (
        <>
          {/* Tabs */}
          <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', background: 'var(--surface)', flexShrink: 0 }}>
            {['status', 'log', 'diff', 'update', 'release'].map(t => (
              <button key={t} onClick={() => setTab(t)} style={{
                padding: '9px 18px', border: 'none', background: 'transparent',
                color: tab === t ? 'var(--amber)' : 'var(--muted)',
                borderBottom: tab === t ? '2px solid var(--amber)' : '2px solid transparent',
                cursor: 'pointer', fontFamily: 'var(--font)', fontSize: '11px', textTransform: 'uppercase',
              }}>{t}</button>
            ))}
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '20px', minHeight: 0 }}>
            {tab === 'status' && status && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {/* Changed files */}
                <div className="hud-card" style={{ padding: '16px' }}>
                  <div className="section-label" style={{ marginBottom: '10px' }}>CHANGED FILES</div>
                  {[...status.modified, ...status.not_added, ...status.deleted, ...status.staged].length === 0
                    ? <div style={{ color: 'var(--muted)', fontSize: '12px' }}>Working tree clean</div>
                    : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        {status.staged.map(f =>     <FileRow key={f} file={f} type="staged" />)}
                        {status.modified.map(f =>   <FileRow key={f} file={f} type="modified" />)}
                        {status.not_added.map(f =>  <FileRow key={f} file={f} type="untracked" />)}
                        {status.deleted.map(f =>    <FileRow key={f} file={f} type="deleted" />)}
                      </div>
                    )
                  }
                </div>

                {/* Commit controls */}
                <div className="hud-card" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div className="section-label">COMMIT & SYNC</div>
                  <input className="input" placeholder="Commit message (feat(scope): description)"
                    value={msg} onChange={e => setMsg(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && commit()} />
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <button className="btn btn-sm" onClick={stageAll}>Stage All</button>
                    <button className="btn btn-sm btn-primary" onClick={commit} disabled={!msg.trim()}>Commit</button>
                    <button className="btn btn-sm btn-primary" onClick={push}>↑ Push</button>
                    <button className="btn btn-sm" onClick={pull}>↓ Pull</button>
                  </div>
                </div>
              </div>
            )}

            {tab === 'log' && (
              <div className="hud-card" style={{ overflow: 'hidden' }}>
                {log.map((entry, i) => (
                  <div key={i} style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', display: 'flex', gap: '14px', alignItems: 'flex-start' }}>
                    <span style={{ fontFamily: 'var(--font)', fontSize: '11px', color: 'var(--accent)', flexShrink: 0, minWidth: '64px' }}>
                      {entry.hash?.slice(0, 7)}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '12px', color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {entry.message}
                      </div>
                      <div style={{ fontSize: '10px', color: 'var(--muted)', marginTop: '2px' }}>
                        {entry.author_name} · {new Date(entry.date).toLocaleString()}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {tab === 'update' && <LocalUpdatePanel repoPath={repoPath} />}

            {tab === 'release' && <ReleasePanel repoPath={repoPath} />}

            {tab === 'diff' && (
              <div className="hud-card" style={{ padding: '0', overflow: 'hidden' }}>
                {diff ? (
                  <pre style={{ padding: '16px', fontSize: '11px', lineHeight: '1.7', overflow: 'auto',
                    color: 'var(--text-dim)', whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: '100%' }}>
                    {diff.split('\n').map((line, i) => (
                      <span key={i} style={{
                        display: 'block',
                        color: line.startsWith('+') ? 'var(--green)' : line.startsWith('-') ? 'var(--red)' : line.startsWith('@@') ? 'var(--accent)' : 'var(--text-dim)',
                      }}>{line}</span>
                    ))}
                  </pre>
                ) : (
                  <div style={{ padding: '20px', color: 'var(--muted)', textAlign: 'center' }}>No diff — working tree clean</div>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function FileRow({ file, type }) {
  const colors = { staged: 'var(--green)', modified: 'var(--amber)', untracked: 'var(--accent)', deleted: 'var(--red)' };
  const labels = { staged: 'S', modified: 'M', untracked: '?', deleted: 'D' };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '3px 0' }}>
      <span style={{ color: colors[type], fontSize: '11px', fontWeight: 700, minWidth: '14px' }}>{labels[type]}</span>
      <span style={{ fontSize: '12px', color: 'var(--text)', fontFamily: 'var(--font)' }}>{file}</span>
    </div>
  );
}
