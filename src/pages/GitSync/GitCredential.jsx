import React, { useCallback, useEffect, useState } from 'react';
import { FS, LH } from '@config/type.js';
import { useUserStore } from '@store/userStore.js';
import {
  REVOKE_NOTE, HOW_TO, headline, details, tokenProblem, actions, testSummary, scrubSummary, stateOf,
} from './gitCredentialModel.js';

/**
 * GitCredential - add, test and remove the GitHub token from the UI (spec Section 157).
 *
 * The token goes in through a password field, is sent once, and the field is cleared the moment it is sent.
 * Nothing on this tab can show a stored token: the main process never returns one. The token is used for push,
 * pull and clone from this app as a one-shot header; it is never put in a remote address.
 */

const inBridge = typeof window !== 'undefined' && !!window.rama?.gitAuth;

export default function GitCredential({ repoPath }) {
  const { canDo } = useUserStore();
  const canWrite = canDo ? canDo('vault.write') : false;
  const canUse = canDo ? canDo('git.push') : false;
  const [st, setSt] = useState(null);
  const [token, setToken] = useState('');
  const [note, setNote] = useState(null);
  const [error, setError] = useState(null);
  const [testLines, setTestLines] = useState([]);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const res = await window.rama.gitAuth.status(repoPath || null);
    if (res?.ok === false) { setError(res.error || 'The token state could not be read.'); return; }
    setError(null);
    setSt(res);
  }, [repoPath]);

  useEffect(() => { if (inBridge && canUse) refresh(); }, [refresh, canUse]);

  if (!inBridge) return <div style={{ fontSize: FS.denseLg, color: 'var(--muted)' }}>The GitHub token needs the Rāma desktop app.</div>;
  if (!canUse) return <div style={{ fontSize: FS.denseLg, color: 'var(--muted)' }}>Your account cannot push, so there is no token to manage.</div>;

  const act = actions(st, { canWrite, canUse });

  const save = async () => {
    const problem = tokenProblem(token);
    if (problem) { setError(problem); return; }
    setBusy(true);
    setNote(null);
    const sent = token;
    setToken('');                                                 // gone from the field before the reply arrives
    const res = await window.rama.gitAuth.set(sent);
    setBusy(false);
    if (res?.ok === false) { setError(res.error || 'The token was not stored.'); return; }
    setError(null);
    setNote(`Stored in the vault (${res.kind === 'classic' ? 'classic' : 'fine-grained'} token). Press TEST to check it with GitHub.`);
    await refresh();
  };

  const run = async (fn, after) => {
    setBusy(true);
    setNote(null);
    const res = await fn();
    setBusy(false);
    if (after) after(res);
    await refresh();
  };

  return (
    <div className="hud-card" style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <div className="section-label">GITHUB TOKEN</div>
      <div role="status" style={{ fontSize: FS.chrome, color: stateOf(st) === 'has-token' ? 'var(--green)' : 'var(--gold)', lineHeight: LH.body }}>{headline(st)}</div>
      {details(st).map((d) => (
        <div key={d} style={{ fontSize: FS.denseLg, color: 'var(--text-dim)', lineHeight: LH.body }}>{d}</div>
      ))}

      <ol style={{ margin: 0, paddingLeft: '18px', fontSize: FS.dense, color: 'var(--muted)', lineHeight: LH.chrome }}>
        {HOW_TO.map((t) => <li key={t}>{t}</li>)}
      </ol>

      {act.save && (
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <input className="input" type="password" value={token} autoComplete="new-password" spellCheck={false}
                 aria-label="GitHub personal access token" placeholder="ghp_… or github_pat_…" style={{ minWidth: '320px', flex: '1 1 320px' }}
                 onChange={(e) => setToken(e.target.value)} />
          <button type="button" className="btn btn-primary btn-sm" disabled={busy || !token.trim()} onClick={save}>
            {stateOf(st) === 'has-token' ? 'REPLACE TOKEN' : 'SAVE TOKEN'}
          </button>
        </div>
      )}
      {act.why && <div style={{ fontSize: FS.dense, color: 'var(--muted)' }}>{act.why}</div>}

      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {act.test && (
          <button type="button" className="btn btn-sm" disabled={busy}
                  onClick={() => run(() => window.rama.gitAuth.test(repoPath || null), (r) => setTestLines(testSummary(r)))}>TEST WITH GITHUB</button>
        )}
        {act.scrub && (
          <button type="button" className="btn btn-sm" disabled={busy || !repoPath}
                  onClick={() => run(() => window.rama.gitAuth.scrub(repoPath), (r) => setNote(scrubSummary(r)))}>REMOVE IT FROM THE REMOTE ADDRESS</button>
        )}
        {act.remove && (
          <button type="button" className="btn btn-sm btn-danger" disabled={busy}
                  onClick={() => { if (window.confirm('Remove the stored GitHub token from the vault? Pushing from this app will then use whatever sign-in this computer has.')) run(() => window.rama.gitAuth.remove(), () => { setTestLines([]); setNote('Removed from the vault.'); }); }}>
            REMOVE TOKEN
          </button>
        )}
        <button type="button" className="btn btn-sm" onClick={refresh}>CHECK AGAIN</button>
      </div>

      {error && <div role="alert" style={{ fontSize: FS.denseLg, color: 'var(--red)', lineHeight: LH.body }}>{error}</div>}
      {note && <div role="status" style={{ fontSize: FS.denseLg, color: 'var(--text)', lineHeight: LH.body }}>{note}</div>}
      {testLines.map((l) => <div key={l} style={{ fontSize: FS.denseLg, color: 'var(--text-dim)', lineHeight: LH.body }}>{l}</div>)}
      <div style={{ fontSize: FS.dense, color: 'var(--muted)', lineHeight: LH.chrome }}>{REVOKE_NOTE}</div>
    </div>
  );
}
