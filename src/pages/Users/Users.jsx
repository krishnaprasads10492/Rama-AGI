import React, { useEffect, useState, useCallback } from 'react';
import { useUserStore }  from '@store/userStore.js';
import { usersApi, keyApi } from '@services/authClient.js';
import { TIERS, TIER_LABELS, TIER_COLORS, getTierBadge, canManage } from '@services/accessControl.js';

// ─── Tier badge ───────────────────────────────────────────────────────────────
function TierBadge({ tier }) {
  const { label, color } = getTierBadge(tier);
  return (
    <span style={{
      padding:      '2px 8px',
      borderRadius: '2px',
      fontSize:     '10px',
      fontWeight:   700,
      letterSpacing:'0.06em',
      textTransform:'uppercase',
      background:   `${color}18`,
      color,
      border:       `1px solid ${color}44`,
    }}>
      {label}
    </span>
  );
}

// ─── Create / Edit user modal ─────────────────────────────────────────────────
/**
 * Create uses username + password + tier. Editing deliberately offers only the
 * two things an administrator should be able to change on someone else's
 * account: their tier and a password reset. Names and keys belong to the account
 * holder, and no path here can grant Master.
 */
function UserModal({ editUser, onSave, onClose }) {
  const isEdit = !!editUser;
  const [displayName, setDisplayName] = useState(editUser?.name ?? '');
  const [username,    setUsername]    = useState(editUser?.username ?? '');
  const [password,    setPassword]    = useState('');
  const [tier,        setTier]        = useState(editUser?.tier ?? TIERS.OPERATOR);
  const [error,       setError]       = useState('');
  const [saving,      setSaving]      = useState(false);
  const [issuedKey,   setIssuedKey]   = useState(null);
  const { sessionToken } = useUserStore();

  // Master is never assignable through user management — it is provisioned once
  const availableTiers = Object.entries(TIERS)
    .filter(([, v]) => v >= TIERS.SUPERADMIN && v <= TIERS.GUEST)
    .map(([k, v]) => ({ key: k, value: v }));

  const handleSave = async () => {
    setError('');

    if (isEdit) {
      setSaving(true);
      // Tier change and password reset are separate operations server-side
      if (tier !== editUser.tier) {
        const res = await usersApi.setTier(sessionToken, editUser.id, tier);
        if (!res?.ok) { setSaving(false); setError(res?.error || 'Could not change tier'); return; }
      }
      if (password.trim()) {
        const res = await usersApi.resetPassword(sessionToken, editUser.id, password.trim());
        if (!res?.ok) { setSaving(false); setError(res?.error || 'Could not reset password'); return; }
      }
      setSaving(false);
      onSave({ ...editUser, tier });
      return;
    }

    if (username.trim().length < 4) { setError('Username must be at least 4 characters'); return; }
    if (!password.trim())           { setError('A password is required for a new account'); return; }

    setSaving(true);
    const res = await usersApi.create(sessionToken, {
      username: username.trim().toLowerCase(),
      password: password.trim(),
      displayName: displayName.trim(),
      tier,
    });
    setSaving(false);

    if (!res?.ok) { setError(res?.error || 'Could not create the account'); return; }

    // The new account's first access key is shown once, here, and never again
    if (res.accessKey) {
      setIssuedKey({ key: res.accessKey, user: res.user, expiresAt: res.keyExpiresAt });
      return;
    }
    onSave(res.user);
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 500 }}>
      <div className="hud-card" style={{ width: '440px', maxWidth: '92vw', padding: '24px',
        display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ fontWeight: 700, color: 'var(--accent)', letterSpacing: '0.08em' }}>
            {issuedKey ? 'ACCOUNT CREATED' : isEdit ? 'EDIT USER' : 'CREATE USER'}
          </span>
          <button className="btn btn-sm" onClick={onClose}>✕</button>
        </div>

        {/* Key handover — the only moment this key exists in readable form */}
        {issuedKey ? (
          <>
            <div style={{ fontSize: '11px', color: 'var(--text-dim)', lineHeight: '1.7' }}>
              Give <strong>{issuedKey.user?.username}</strong> both their password and
              the key below. They need both to sign in.
            </div>
            <div style={{
              fontFamily: 'monospace', fontSize: '20px', letterSpacing: '0.14em',
              textAlign: 'center', padding: '14px', color: 'var(--gold)',
              background: 'var(--surface)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius)', userSelect: 'all',
            }}>
              {issuedKey.key}
            </div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <button className="btn btn-sm" style={{ flex: 1, justifyContent: 'center' }}
                onClick={() => navigator.clipboard?.writeText(issuedKey.key)}>
                Copy key
              </button>
              {issuedKey.expiresAt && (
                <span style={{ fontSize: '9px', color: 'var(--muted)' }}>
                  Expires {new Date(issuedKey.expiresAt).toLocaleDateString()}
                </span>
              )}
            </div>
            <button className="btn btn-sm btn-primary" style={{ justifyContent: 'center' }}
              onClick={() => onSave(issuedKey.user)}>
              Done
            </button>
          </>
        ) : (
          <>
            {!isEdit && (
              <>
                <div>
                  <div className="section-label" style={{ marginBottom: '5px' }}>USERNAME</div>
                  <input className="input" value={username} placeholder="4–32 chars, lowercase"
                    onChange={e => { setUsername(e.target.value.toLowerCase()); setError(''); }} />
                </div>
                <div>
                  <div className="section-label" style={{ marginBottom: '5px' }}>DISPLAY NAME</div>
                  <input className="input" value={displayName} placeholder="optional"
                    onChange={e => setDisplayName(e.target.value)} />
                </div>
              </>
            )}

            {isEdit && (
              <div style={{ fontSize: '11px', color: 'var(--text-dim)' }}>
                Editing <strong>{editUser.username}</strong>
              </div>
            )}

            <div>
              <div className="section-label" style={{ marginBottom: '5px' }}>
                {isEdit ? 'RESET PASSWORD (leave blank to keep)' : 'PASSWORD'}
              </div>
              <input className="input" type="password" value={password} placeholder="••••••••••••"
                autoComplete="new-password"
                onChange={e => { setPassword(e.target.value); setError(''); }} />
              <div style={{ fontSize: '9px', color: 'var(--muted)', marginTop: '4px' }}>
                10+ characters with upper, lower, number and symbol
              </div>
            </div>

            <div>
              <div className="section-label" style={{ marginBottom: '8px' }}>ACCESS TIER</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' }}>
                {availableTiers.map(({ key, value }) => (
                  <button key={key} onClick={() => setTier(value)} style={{
                    padding: '8px 6px', border: `1px solid ${tier === value ? TIER_COLORS[value] : 'var(--border)'}`,
                    borderRadius: 'var(--radius)', background: tier === value ? `${TIER_COLORS[value]}15` : 'transparent',
                    color: tier === value ? TIER_COLORS[value] : 'var(--muted)',
                    cursor: 'pointer', fontFamily: 'var(--font)', fontSize: '11px', textAlign: 'center',
                  }}>
                    {TIER_LABELS[value]}
                  </button>
                ))}
              </div>
              <TierDescriptions tier={tier} />
            </div>

            {error && <div style={{ color: 'var(--red)', fontSize: '11px' }}>{error}</div>}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '4px' }}>
              <button className="btn btn-sm" onClick={onClose}>Cancel</button>
              <button className="btn btn-sm btn-primary" disabled={saving} onClick={handleSave}>
                {saving ? 'Saving...' : isEdit ? 'Save Changes' : 'Create User'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function TierDescriptions({ tier }) {
  const descs = {
    [TIERS.SUPERADMIN]: 'Full capability. No vault/master identity access.',
    [TIERS.ADMIN]:      'User management, chat, agents, StockMind. No OS/vault.',
    [TIERS.OPERATOR]:   'Chat, agents, StockMind, read-only system. No management.',
    [TIERS.VIEWER]:     'Read-only: chat history, knowledge base, reports.',
    [TIERS.GUEST]:      'Single-session chat only. No persistence. Masked AGI.',
  };
  return (
    <div style={{ fontSize: '10px', color: 'var(--text-dim)', marginTop: '6px', fontStyle: 'italic' }}>
      {descs[tier] || ''}
    </div>
  );
}

// ─── User row ─────────────────────────────────────────────────────────────────
function UserRow({ user, currentUser, onEdit, onSuspend, onDelete, onIssueKey }) {
  const [confirm, setConfirm] = useState(null);
  const canAct    = canManage(currentUser, user);
  const suspended = user.isActive === false;

  return (
    <tr style={{ borderBottom: '1px solid var(--border)' }}>
      <td style={{ padding: '10px 14px' }}>
        <div style={{ fontWeight: 600, fontSize: '12px', color: 'var(--text)' }}>{user.name}</div>
        <div style={{ fontSize: '10px', color: 'var(--muted)' }}>{user.username}</div>
      </td>
      <td style={{ padding: '10px 14px' }}><TierBadge tier={user.tier} /></td>
      <td style={{ padding: '10px 14px' }}>
        <span style={{
          fontSize: '10px', fontWeight: 700, letterSpacing: '0.06em',
          color: suspended ? 'var(--red)' : 'var(--green)',
        }}>
          {suspended ? 'SUSPENDED' : 'ACTIVE'}
        </span>
        {user.isMaster && (
          <span style={{ fontSize: '10px', color: 'var(--violet)', marginLeft: '8px' }}>MASTER</span>
        )}
        {/* A password without a key cannot sign in — say so rather than let them find out */}
        {!user.hasKey && (
          <span style={{ fontSize: '9px', color: 'var(--amber)', marginLeft: '8px' }} title="No access key issued">
            NO KEY
          </span>
        )}
        {user.hasKey && user.keyExpiresAt && user.keyExpiresAt < Date.now() && (
          <span style={{ fontSize: '9px', color: 'var(--amber)', marginLeft: '8px' }}>KEY EXPIRED</span>
        )}
      </td>
      <td style={{ padding: '10px 14px', fontSize: '10px', color: 'var(--muted)' }}>
        {user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : 'Never'}
      </td>
      <td style={{ padding: '10px 14px' }}>
        {canAct && !user.isMaster && (
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            <button className="btn btn-sm" onClick={() => onEdit(user)} style={{ fontSize: '10px' }}>Edit</button>
            <button className="btn btn-sm" onClick={() => onIssueKey(user)} style={{ fontSize: '10px' }}
              title="Issue a fresh access key for this account">
              Issue key
            </button>
            <button className="btn btn-sm" onClick={() => onSuspend(user)}
              style={{ fontSize: '10px', color: suspended ? 'var(--green)' : 'var(--amber)',
                borderColor: suspended ? 'var(--green)' : 'var(--amber)' }}>
              {suspended ? 'Unsuspend' : 'Suspend'}
            </button>
            {currentUser.tier === TIERS.MASTER && (
              confirm === user.id ? (
                <>
                  <button className="btn btn-sm btn-danger" style={{ fontSize: '10px' }}
                    onClick={() => { onDelete(user); setConfirm(null); }}>Confirm</button>
                  <button className="btn btn-sm" style={{ fontSize: '10px' }}
                    onClick={() => setConfirm(null)}>Cancel</button>
                </>
              ) : (
                <button className="btn btn-sm btn-danger" style={{ fontSize: '10px' }}
                  onClick={() => setConfirm(user.id)}>Delete</button>
              )
            )}
          </div>
        )}
      </td>
    </tr>
  );
}

// ─── Main Users page ──────────────────────────────────────────────────────────
export default function Users() {
  const { users, currentUser, sessionToken, setUsers, addUser, updateUser, removeUser, canDo } = useUserStore();
  const [loading,   setLoading]   = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editUser,  setEditUser]  = useState(null);
  const [error,     setError]     = useState('');
  const [issuedKey, setIssuedKey] = useState(null);

  const load = useCallback(async () => {
    if (!canDo('users.view')) return;
    setLoading(true);
    const res = await usersApi.list(sessionToken);
    setLoading(false);
    if (res.ok) setUsers(res.data);
    else setError(res.error);
  }, [canDo, sessionToken, setUsers]);

  useEffect(() => { load(); }, [load]);

  const handleSuspend = async (user) => {
    const res = await usersApi.setActive(sessionToken, user.id, user.isActive === false);
    if (res?.ok) updateUser(user.id, { isActive: user.isActive === false });
    else setError(res?.error || 'Could not change account state');
  };

  const handleDelete = async (user) => {
    const res = await usersApi.remove(sessionToken, user.id);
    if (res?.ok) removeUser(user.id);
    else setError(res?.error || 'Could not delete the account');
  };

  // Issuing a key invalidates the previous one — shown once, then unrecoverable
  const handleIssueKey = async (user) => {
    setError('');
    const res = await keyApi.issueFor(sessionToken, user.id, 30);
    if (res?.ok) {
      setIssuedKey({ key: res.key, username: user.username, expiresAt: res.expiresAt });
      updateUser(user.id, { hasKey: true, keyExpiresAt: res.expiresAt });
    } else {
      setError(res?.error || 'Could not issue an access key');
    }
  };

  const handleSave = (saved) => {
    if (editUser) updateUser(saved.id, saved);
    else addUser(saved);
    setShowModal(false);
    setEditUser(null);
  };

  if (!canDo('users.view')) {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: 'var(--red)', fontSize: '13px' }}>⛔ Access denied — Admin or higher required</div>
      </div>
    );
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {(showModal || editUser) && (
        <UserModal
          editUser={editUser}
          onSave={handleSave}
          onClose={() => { setShowModal(false); setEditUser(null); }}
        />
      )}

      {/* Freshly issued key — the only moment it is readable */}
      {issuedKey && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 500 }}>
          <div className="hud-card" style={{ width: '400px', maxWidth: '92vw', padding: '24px',
            display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <span style={{ fontWeight: 700, color: 'var(--gold)', letterSpacing: '0.08em' }}>
              ACCESS KEY FOR {issuedKey.username?.toUpperCase()}
            </span>
            <div style={{
              fontFamily: 'monospace', fontSize: '20px', letterSpacing: '0.14em',
              textAlign: 'center', padding: '14px', color: 'var(--gold)',
              background: 'var(--surface)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius)', userSelect: 'all',
            }}>
              {issuedKey.key}
            </div>
            <div style={{ fontSize: '10px', color: 'var(--amber)', lineHeight: '1.7' }}>
              Shown once. Their previous key stopped working the moment this was
              issued. Only an HMAC is stored, so it cannot be looked up later.
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button className="btn btn-sm" style={{ flex: 1, justifyContent: 'center' }}
                onClick={() => navigator.clipboard?.writeText(issuedKey.key)}>
                Copy
              </button>
              <button className="btn btn-sm btn-primary" style={{ flex: 1, justifyContent: 'center' }}
                onClick={() => setIssuedKey(null)}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', background: 'var(--surface)',
        display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
        <span style={{ fontWeight: 700, color: 'var(--accent)', letterSpacing: '0.1em' }}>USER MANAGEMENT</span>
        <span className="badge badge-cyan">{users.length} USERS</span>
        <div style={{ flex: 1 }} />
        <button className="btn btn-sm" onClick={load}>↺ Refresh</button>
        {canDo('users.create') && (
          <button className="btn btn-sm btn-primary" onClick={() => setShowModal(true)}>+ Create User</button>
        )}
      </div>

      {/* Access tier legend */}
      <div style={{ padding: '10px 20px', borderBottom: '1px solid var(--border)', background: 'var(--surface)',
        display: 'flex', gap: '10px', flexWrap: 'wrap', flexShrink: 0 }}>
        {Object.entries(TIER_LABELS).map(([tier, label]) => (
          <div key={tier} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <TierBadge tier={parseInt(tier)} />
          </div>
        ))}
        <span style={{ fontSize: '10px', color: 'var(--muted)', marginLeft: 'auto' }}>
          Lower tier = higher privilege
        </span>
      </div>

      {/* Table */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {loading ? (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--muted)' }}>Loading users...</div>
        ) : error ? (
          <div style={{ padding: '20px', color: 'var(--red)', fontSize: '12px' }}>{error}</div>
        ) : users.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--muted)', fontSize: '12px' }}>
            No users yet. Create one to grant access.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
                {['User', 'Tier', 'Status', 'Last Login', 'Actions'].map(h => (
                  <th key={h} style={{ padding: '10px 14px', fontSize: '10px', color: 'var(--muted)',
                    letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 700, textAlign: 'left' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map(user => (
                <UserRow key={user.id} user={user} currentUser={currentUser}
                  onEdit={(u) => { setEditUser(u); setShowModal(true); }}
                  onSuspend={handleSuspend}
                  onDelete={handleDelete}
                  onIssueKey={handleIssueKey}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
