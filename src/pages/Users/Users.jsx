import React, { useEffect, useState, useCallback } from 'react';
import { useUserStore }  from '@store/userStore.js';
import { usersApi }      from '@services/authClient.js';
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
function UserModal({ editUser, onSave, onClose, currentUser }) {
  const isEdit = !!editUser;
  const [name,     setName]     = useState(editUser?.name     || '');
  const [email,    setEmail]    = useState(editUser?.email    || '');
  const [password, setPassword] = useState('');
  const [tier,     setTier]     = useState(editUser?.tier ?? TIERS.OPERATOR);
  const [error,    setError]    = useState('');
  const [saving,   setSaving]   = useState(false);
  const { sessionToken } = useUserStore();

  const availableTiers = Object.entries(TIERS)
    .filter(([, v]) => v >= TIERS.SUPERADMIN && v <= TIERS.GUEST)
    .map(([k, v]) => ({ key: k, value: v }));

  const handleSave = async () => {
    if (!name.trim() || !email.trim()) { setError('Name and email required'); return; }
    if (!isEdit && !password.trim())   { setError('Password required for new user'); return; }
    setSaving(true);
    const data = { name: name.trim(), email: email.trim(), tier };
    if (password.trim()) data.password = password.trim();

    let res;
    if (isEdit) {
      res = await usersApi.update(sessionToken, editUser.id, data);
    } else {
      res = await usersApi.create(sessionToken, data);
    }
    setSaving(false);
    if (!res.ok) { setError(res.error); return; }
    onSave(res.user);
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 500 }}>
      <div className="hud-card" style={{ width: '440px', padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ fontWeight: 700, color: 'var(--accent)', letterSpacing: '0.08em' }}>
            {isEdit ? 'EDIT USER' : 'CREATE USER'}
          </span>
          <button className="btn btn-sm" onClick={onClose}>✕</button>
        </div>

        {[
          { label: 'FULL NAME', value: name, set: setName, type: 'text',     placeholder: 'Krishna Prasad' },
          { label: 'EMAIL',     value: email, set: setEmail, type: 'email',   placeholder: 'user@example.com' },
          { label: isEdit ? 'NEW PASSWORD (leave blank to keep)' : 'PASSWORD',
            value: password, set: setPassword, type: 'password', placeholder: '••••••••••••' },
        ].map(f => (
          <div key={f.label}>
            <div className="section-label" style={{ marginBottom: '5px' }}>{f.label}</div>
            <input className="input" type={f.type} placeholder={f.placeholder}
              value={f.value} onChange={e => f.set(e.target.value)} />
          </div>
        ))}

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
function UserRow({ user, currentUser, onEdit, onSuspend, onDelete }) {
  const [confirm, setConfirm] = useState(null);
  const canAct = canManage(currentUser, user);

  return (
    <tr style={{ borderBottom: '1px solid var(--border)' }}>
      <td style={{ padding: '10px 14px' }}>
        <div style={{ fontWeight: 600, fontSize: '12px', color: 'var(--text)' }}>{user.name}</div>
        <div style={{ fontSize: '10px', color: 'var(--muted)' }}>{user.email}</div>
      </td>
      <td style={{ padding: '10px 14px' }}><TierBadge tier={user.tier} /></td>
      <td style={{ padding: '10px 14px' }}>
        <span style={{
          fontSize: '10px', fontWeight: 700, letterSpacing: '0.06em',
          color: user.suspended ? 'var(--red)' : 'var(--green)',
        }}>
          {user.suspended ? 'SUSPENDED' : 'ACTIVE'}
        </span>
        {user.isMaster && (
          <span style={{ fontSize: '10px', color: 'var(--violet)', marginLeft: '8px' }}>MASTER</span>
        )}
      </td>
      <td style={{ padding: '10px 14px', fontSize: '10px', color: 'var(--muted)' }}>
        {user.lastLogin ? new Date(user.lastLogin).toLocaleString() : 'Never'}
      </td>
      <td style={{ padding: '10px 14px' }}>
        {canAct && !user.isMaster && (
          <div style={{ display: 'flex', gap: '6px' }}>
            <button className="btn btn-sm" onClick={() => onEdit(user)} style={{ fontSize: '10px' }}>Edit</button>
            <button className="btn btn-sm" onClick={() => onSuspend(user)}
              style={{ fontSize: '10px', color: user.suspended ? 'var(--green)' : 'var(--amber)',
                borderColor: user.suspended ? 'var(--green)' : 'var(--amber)' }}>
              {user.suspended ? 'Unsuspend' : 'Suspend'}
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
    const res = await usersApi.suspend(sessionToken, user.id);
    if (res.ok) updateUser(user.id, { suspended: res.suspended });
  };

  const handleDelete = async (user) => {
    const res = await usersApi.delete(sessionToken, user.id);
    if (res.ok) removeUser(user.id);
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
          currentUser={currentUser}
          onSave={handleSave}
          onClose={() => { setShowModal(false); setEditUser(null); }}
        />
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
                />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
