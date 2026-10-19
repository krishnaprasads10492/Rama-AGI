import React, { useState } from 'react';
import { FS, LH } from '@config/type.js';
import { keyRow, EXPIRY_EVENT } from '@pages/GitSync/gitCredentialModel.js';

/**
 * GitHubKeyFacts - what is known about the stored GitHub token, shown beside it in Models > Keys (spec Section 158).
 *
 * Words only: the state comes from the main process (`gitAuth:expiry`), the sentences from `keyRow`. The token is
 * never here. A date can be typed only when GitHub did not report an expiry; GitHub's own date is never overridden.
 * The state is named in words as well as colour.
 */

export const TONE = { good: 'var(--green)', warn: 'var(--amber)', bad: 'var(--red)', idle: 'var(--muted)' };

export default function GitHubKeyFacts({ data, canWrite, onChanged }) {
  const row = keyRow(data?.notice, { vaultUnlocked: data?.vaultUnlocked, stored: data?.stored });
  const [date, setDate] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const saveDate = async () => {
    setBusy(true);
    const res = await window.rama.gitAuth.setExpiry(date);
    setBusy(false);
    if (res?.ok === false) { setError(res.error || 'The date was not saved.'); return; }
    setError(null);
    setDate('');
    window.dispatchEvent(new Event(EXPIRY_EVENT));
    if (onChanged) onChanged();
  };

  return (
    <div style={{ marginTop: '6px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
      <div style={{ fontSize: FS.chrome, lineHeight: LH.chrome, color: TONE[row.tone], fontWeight: 700, letterSpacing: '0.06em' }}>{row.label}</div>
      {row.lines.map((l) => (
        <div key={l} style={{ fontSize: FS.chrome, lineHeight: LH.chrome, color: 'var(--text-dim)' }}>{l}</div>
      ))}
      {row.canTypeDate && canWrite && (
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginTop: '4px' }}>
          <label style={{ fontSize: FS.chrome, lineHeight: LH.chrome, color: 'var(--muted)' }} htmlFor="gh-expiry-date">
            Expiry date shown at github.com/settings/tokens
          </label>
          <input id="gh-expiry-date" className="input" type="date" value={date} onChange={(e) => { setDate(e.target.value); setError(null); }} />
          <button type="button" className="btn btn-sm" disabled={busy || !date} onClick={saveDate}>SAVE DATE</button>
        </div>
      )}
      {error && <div role="alert" style={{ fontSize: FS.chrome, lineHeight: LH.chrome, color: 'var(--red)' }}>{error}</div>}
    </div>
  );
}
