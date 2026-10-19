import React, { useCallback, useEffect, useState } from 'react';
import { FS, LH } from '@config/type.js';
import { can } from '@services/accessControl.js';
import {
  REASON, ipStatus, changeLock, groupByDistributable, draftProblems, blankDraft, draftFrom,
  isWeeklyLock, visibleTo, mayWrite, isKite, sessionStatus, KITE_STEPS, KITE_REDIRECT_NOTE,
} from './brokerAccountsModel.js';

/**
 * BrokerAccounts - several broker API accounts and the static IP each is registered under (spec Section 152).
 *
 * SUPERADMIN ONLY, and not merely hidden. The panel renders nothing and asks for nothing unless the signed-in
 * account holds `brokers.accounts.view`; the main process refuses regardless, so this check is courtesy and the
 * gate is the other side. The API secret is typed into a box that is always empty, sent once, and never comes
 * back: the list shows only that a secret is stored. There is no "show secret".
 */

const inBridge = typeof window !== 'undefined' && !!window.rama?.brokerAccounts;
const TONE = { good: 'var(--green)', bad: 'var(--red)', muted: 'var(--muted)' };

const Field = ({ label, children }) => (
  <label style={{ display: 'flex', flexDirection: 'column', gap: '3px', fontSize: FS.dense, color: 'var(--muted)', minWidth: '150px', flex: '1 1 150px' }}>
    {label}
    {children}
  </label>
);

export default function BrokerAccounts({ currentUser }) {
  const allowed = visibleTo(can, currentUser);
  const writable = mayWrite(can, currentUser);
  const [snap, setSnap] = useState(null);
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState(null);
  const [lock, setLock] = useState(null);
  const [distLabel, setDistLabel] = useState('');
  const [loginFor, setLoginFor] = useState(null);       // account id with a Kite login in progress
  const [redirectText, setRedirectText] = useState('');

  const load = useCallback(async () => {
    const res = await window.rama.brokerAccounts.list();
    if (res?.ok === false) { setError(res.error || 'The registry could not be read.'); return; }
    setError(null);
    setSnap(res.data || null);
  }, []);

  // The read happens only for an account that may see the data. A refused caller never makes the call.
  useEffect(() => { if (allowed && inBridge) load(); }, [allowed, load]);

  if (!allowed) return null;
  if (!inBridge) return <div style={{ fontSize: FS.denseLg, color: 'var(--muted)' }}>Broker accounts need the Rāma desktop app.</div>;

  const run = async (fn, done) => {
    setBusy(true);
    setNote(null);
    const res = await fn();
    setBusy(false);
    if (res?.ok === false) {
      if (isWeeklyLock(res)) { setLock(res); return res; }
      setError(res.error || 'That did not work.');
      return res;
    }
    setError(null);
    setLock(null);
    if (done) setNote(done);
    await load();
    return res;
  };

  const submit = async (acknowledge = false) => {
    const problems = draftProblems(draft);
    if (problems.length) { setError(problems.join(' ')); return; }
    const res = await run(() => window.rama.brokerAccounts.save({ ...draft, acknowledgeWeeklyLimit: acknowledge }),
      draft.id ? 'Account updated.' : 'Account saved. The secret is stored encrypted and will not be shown again.');
    if (res?.ok) setDraft(null);
  };

  const startLogin = async (id) => {
    const res = await run(() => window.rama.kiteSession.loginStart(id));
    if (res?.ok) { setLoginFor(id); setRedirectText(''); setNote(res.opened ? 'Kite\'s login page was opened in your browser.' : `Open this address in your browser: ${res.url}`); }
  };
  const finishLogin = async (id) => {
    const res = await run(() => window.rama.kiteSession.loginComplete(id, redirectText), 'Logged in to Kite.');
    if (res?.ok) { setLoginFor(null); setRedirectText(''); }
  };

  const groups = groupByDistributable(snap);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }} aria-label="Broker accounts">
      <div className="hud-card" style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <div className="section-label">BROKER API ACCOUNTS AND WHITELISTED IPs</div>
        <details>
          <summary style={{ cursor: 'pointer', fontSize: FS.denseLg, color: 'var(--text)' }}>{REASON.title}</summary>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', paddingTop: '6px' }}>
            {REASON.lines.map((l) => (
              <div key={l} style={{ fontSize: FS.denseLg, lineHeight: LH.body, color: 'var(--text-dim)' }}>{l}</div>
            ))}
          </div>
        </details>
        <div style={{ fontSize: FS.dense, color: 'var(--muted)', lineHeight: LH.chrome }}>
          Visible to SuperAdmin only. API secrets are stored encrypted and are never displayed.
        </div>
      </div>

      {error && <div role="alert" style={{ color: 'var(--red)', fontSize: FS.denseLg, lineHeight: LH.body }}>{error}</div>}
      {note && <div role="status" style={{ color: 'var(--text)', fontSize: FS.denseLg }}>{note}</div>}

      {snap && (
        <div className="hud-card" style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: FS.denseLg, color: 'var(--text)' }}>
            This installation: <strong>{snap.self.label}</strong>
            {snap.detected ? ` · detected ${snap.detected.ip} on ${String(snap.detected.at).slice(0, 10)} via ${snap.detected.source}` : ' · address not detected yet'}
          </span>
          <span style={{ flex: 1 }} />
          {writable && (
            <button type="button" className="btn btn-sm" disabled={busy}
                    onClick={() => run(() => window.rama.brokerAccounts.detectIp(), 'Detected this machine\'s address.')}
                    title="Asks a public IP-echo service which address it sees. That tells the service this machine's address.">
              DETECT THIS MACHINE'S IP
            </button>
          )}
        </div>
      )}

      {groups.map((g) => (
        <div key={g.id} className="hud-card" style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <strong style={{ fontSize: FS.chrome, color: 'var(--text)' }}>{g.label}</strong>
            {g.self && <span className="badge badge-cyan">THIS INSTALLATION</span>}
            <span style={{ fontSize: FS.dense, color: 'var(--muted)' }}>{g.sentence}</span>
            <span style={{ flex: 1 }} />
            {writable && !g.self && (
              <button type="button" className="btn btn-sm btn-danger" disabled={busy || g.accounts.length > 0}
                      title={g.accounts.length ? 'Remove or move its accounts first.' : 'Remove this distributable'}
                      onClick={() => run(() => window.rama.brokerAccounts.distributableRemove(g.id), 'Distributable removed.')}>
                REMOVE
              </button>
            )}
            {writable && (
              <button type="button" className="btn btn-sm" disabled={busy}
                      onClick={() => setDraft(blankDraft(g.id))}>
                + ADD ACCOUNT
              </button>
            )}
          </div>

          {g.accounts.length === 0 && (
            <div style={{ fontSize: FS.denseLg, color: 'var(--muted)' }}>No account on this distributable yet.</div>
          )}

          {g.accounts.map((a) => {
            const st = ipStatus(a);
            const locked = changeLock(a);
            return (
              <div key={a.id} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                  <strong style={{ fontSize: FS.denseLg, color: 'var(--text)' }}>{a.label}</strong>
                  <span style={{ fontSize: FS.dense, color: 'var(--muted)' }}>{a.brokerId}{a.clientId ? ` · ${a.clientId}` : ''}</span>
                  <span style={{ fontSize: FS.dense, color: 'var(--muted)' }}>key {a.apiKeyMasked}</span>
                  <span style={{ fontSize: FS.dense, color: a.hasSecret ? 'var(--muted)' : 'var(--red)' }}>
                    {a.hasSecret ? 'secret stored (hidden)' : 'no secret stored'}
                  </span>
                  <span style={{ flex: 1 }} />
                  {writable && (
                    <>
                      <button type="button" className="btn btn-sm" disabled={busy} onClick={() => setDraft(draftFrom(a))}>EDIT</button>
                      <button type="button" className="btn btn-sm btn-danger" disabled={busy}
                              onClick={() => { if (window.confirm(`Remove "${a.label}" and its stored secret?`)) run(() => window.rama.brokerAccounts.remove(a.id), 'Account removed.'); }}>
                        REMOVE
                      </button>
                    </>
                  )}
                </div>
                <div style={{ fontSize: FS.denseLg, color: 'var(--text)' }}>
                  Primary {a.primaryIp || '—'} · Secondary {a.secondaryIp || '—'}
                  {a.sharedWithFamily ? ' · shared with family (declared)' : ''}
                </div>
                <div style={{ fontSize: FS.dense, color: TONE[st.tone], lineHeight: LH.chrome }}>
                  <strong>{st.label}</strong> {st.text}
                </div>
                {locked && <div style={{ fontSize: FS.dense, color: 'var(--gold)' }}>{locked}</div>}
                {isKite(a) && writable && (() => {
                  const ss = sessionStatus(a);
                  return (
                    <div style={{ borderTop: '1px solid var(--border)', paddingTop: '6px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <span className={ss.tone === 'good' ? 'badge badge-green' : ss.tone === 'bad' ? 'badge badge-red' : 'badge'}>{ss.label}</span>
                        <span style={{ fontSize: FS.dense, color: 'var(--muted)', lineHeight: LH.chrome }}>{ss.text}</span>
                        <span style={{ flex: 1 }} />
                        <button type="button" className="btn btn-sm" disabled={busy || !a.hasSecret} onClick={() => startLogin(a.id)}
                                title={a.hasSecret ? 'Opens Zerodha\'s login page in your browser' : 'Store the API secret first'}>OPEN KITE LOGIN</button>
                        {ss.state !== 'none' && (
                          <button type="button" className="btn btn-sm" disabled={busy}
                                  onClick={() => run(() => window.rama.kiteSession.logout(a.id), 'Logged out of Kite.')}>LOG OUT</button>
                        )}
                      </div>
                      {loginFor === a.id && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          <ol style={{ margin: 0, paddingLeft: '18px', fontSize: FS.dense, color: 'var(--text-dim)', lineHeight: LH.chrome }}>
                            {KITE_STEPS.map((t) => <li key={t}>{t}</li>)}
                          </ol>
                          <input className="input" value={redirectText} spellCheck={false} autoComplete="off" aria-label="Address Kite redirected to"
                                 placeholder="http://127.0.0.1/?request_token=...&action=login&status=success&state=..."
                                 onChange={(e) => setRedirectText(e.target.value)} />
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <button type="button" className="btn btn-primary btn-sm" disabled={busy || !redirectText.trim()} onClick={() => finishLogin(a.id)}>COMPLETE LOGIN</button>
                            <button type="button" className="btn btn-sm" onClick={() => { setLoginFor(null); setRedirectText(''); }}>CANCEL</button>
                          </div>
                          <div style={{ fontSize: FS.dense, color: 'var(--muted)', lineHeight: LH.chrome }}>{KITE_REDIRECT_NOTE}</div>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            );
          })}
        </div>
      ))}

      {writable && snap && (
        <div className="hud-card" style={{ padding: '12px 16px', display: 'flex', alignItems: 'flex-end', gap: '10px', flexWrap: 'wrap' }}>
          <Field label="New distributable (an installation you will hand out)">
            <input className="input" value={distLabel} maxLength={60} placeholder="e.g. Ravi's laptop"
                   onChange={(e) => setDistLabel(e.target.value)} />
          </Field>
          <button type="button" className="btn btn-sm" disabled={busy || !distLabel.trim()}
                  onClick={async () => { const r = await run(() => window.rama.brokerAccounts.distributableSave({ label: distLabel }), 'Distributable added.'); if (r?.ok) setDistLabel(''); }}>
            ADD DISTRIBUTABLE
          </button>
        </div>
      )}

      {writable && draft && (
        <div className="hud-card" style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div className="section-label">{draft.id ? 'EDIT ACCOUNT' : 'NEW ACCOUNT'}</div>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <Field label="Label">
              <input className="input" value={draft.label} maxLength={60} onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
            </Field>
            <Field label="Zerodha client ID (optional)">
              <input className="input" value={draft.clientId} maxLength={16} autoComplete="off" onChange={(e) => setDraft({ ...draft, clientId: e.target.value })} />
            </Field>
            <Field label={draft.id ? 'API key (blank keeps the stored one)' : 'API key'}>
              <input className="input" value={draft.apiKey} autoComplete="off" spellCheck={false} onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })} />
            </Field>
            <Field label={draft.id ? 'API secret (blank keeps the stored one)' : 'API secret'}>
              <input className="input" type="password" value={draft.secret} autoComplete="new-password" spellCheck={false}
                     onChange={(e) => setDraft({ ...draft, secret: e.target.value })} />
            </Field>
          </div>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <Field label="Primary static IP">
              <input className="input" value={draft.primaryIp} placeholder="e.g. 103.21.58.10" spellCheck={false} onChange={(e) => setDraft({ ...draft, primaryIp: e.target.value })} />
            </Field>
            <Field label="Secondary static IP (optional)">
              <input className="input" value={draft.secondaryIp} spellCheck={false} onChange={(e) => setDraft({ ...draft, secondaryIp: e.target.value })} />
            </Field>
            <Field label="Distributable">
              <select className="input" value={draft.distributableId} onChange={(e) => setDraft({ ...draft, distributableId: e.target.value })}>
                {(snap?.distributables || []).map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
              </select>
            </Field>
          </div>
          <label style={{ fontSize: FS.denseLg, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <input type="checkbox" checked={draft.sharedWithFamily} onChange={(e) => setDraft({ ...draft, sharedWithFamily: e.target.checked })} />
            This IP is shared only with my immediate family's accounts (Zerodha's declaration)
          </label>
          <Field label="Notes (optional)">
            <input className="input" value={draft.notes} maxLength={200} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
          </Field>
          {lock && (
            <div role="alert" style={{ borderLeft: '2px solid var(--gold)', paddingLeft: '8px', fontSize: FS.denseLg, color: 'var(--text)', lineHeight: LH.body }}>
              {lock.error}
              <div style={{ paddingTop: '6px' }}>
                <button type="button" className="btn btn-sm" disabled={busy} onClick={() => submit(true)}>I HAVE ALREADY CHANGED IT AT ZERODHA, RECORD IT</button>
              </div>
            </div>
          )}
          <div style={{ display: 'flex', gap: '8px' }}>
            <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => submit(false)}>SAVE</button>
            <button type="button" className="btn btn-sm" disabled={busy} onClick={() => { setDraft(null); setLock(null); setError(null); }}>CANCEL</button>
          </div>
        </div>
      )}
    </div>
  );
}
