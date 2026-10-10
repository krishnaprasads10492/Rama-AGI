import React, { useState, useEffect, useCallback } from 'react';
import { FS, LH } from '@config/type.js';

/**
 * Knowledge — Rāma's persistent memory and knowledge base.
 * Phase 5 will wire this to MongoDB for full CRUD + vector search.
 */
const isElectron = typeof window !== 'undefined' && !!window.rama;

export default function Knowledge() {
  const [search, setSearch] = useState('');
  /**
   * BACKED BY THE REAL STORE, AND IT USED TO SHIP TWO FABRICATED ENTRIES (audit H8, Section 144).
   *
   * `useState([...])` held "System Architecture" and "StockMind Integration" — plausible-looking rows
   * that were never written by anyone, could not be deleted, and survived a restart because they were
   * never persisted in the first place. A memory page that invents its own memories is worse than an
   * empty one: it teaches master that what he reads here is real.
   *
   * The `knowledge` domain has existed in `dataStore.cjs:159` the whole time — `{ entries: [], index:
   * {} }`, encrypted, autosaved and re-keyed with every other domain under I14. It was loaded, saved
   * and re-keyed and never written to. This page is now its producer.
   */
  const [entries, setEntries] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ title: '', content: '', tags: '' });

  const load = useCallback(async () => {
    if (!isElectron) { setLoaded(true); return; }
    try {
      const res = await window.rama.store.get('knowledge', 'entries');
      // `ok:false` means the store is LOCKED, which is a different fact from "no entries" and is
      // reported rather than rendered as emptiness.
      if (res?.ok === false) { setError(res.error || 'the knowledge store could not be read'); }
      else setEntries(Array.isArray(res?.data) ? res.data : (Array.isArray(res) ? res : []));
    } catch (err) {
      setError(`the knowledge store did not answer: ${err?.message || String(err)}`);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const addEntry = useCallback(async () => {
    const title = draft.title.trim();
    if (!title || !isElectron) return;
    const item = {
      title,
      content: draft.content.trim(),
      tags: draft.tags.split(',').map(t => t.trim().toLowerCase()).filter(Boolean),
      ts: Date.now(),
    };
    // `store.push` stamps `_id` and `_ts` in the main process, which is why no id is invented here.
    const res = await window.rama.store.push('knowledge', 'entries', item);
    if (res?.ok === false) { setError(res.error || 'the entry was not saved'); return; }
    setError(null);
    setDraft({ title: '', content: '', tags: '' });
    setAdding(false);
    load();
  }, [draft, load]);

  const removeEntry = useCallback(async (id) => {
    if (!isElectron || id === undefined) return;
    const res = await window.rama.store.remove('knowledge', 'entries', id);
    if (res?.ok === false) { setError(res.error || 'the entry was not removed'); return; }
    load();
  }, [load]);

  const q = search.trim().toLowerCase();
  const text = (e) => `${e?.title ?? ''} ${e?.content ?? e?.excerpt ?? ''}`.toLowerCase();
  const filtered = q.length === 0 ? entries : entries.filter(e =>
    text(e).includes(q) || (Array.isArray(e?.tags) && e.tags.some(t => String(t).includes(q)))
  );

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', background: 'var(--surface)',
        display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
        <span style={{ fontWeight: 700, color: 'var(--accent)', letterSpacing: '0.1em' }}>KNOWLEDGE BASE</span>
        <span className="badge badge-cyan">RĀMA MEMORY</span>
        <div style={{ flex: 1 }} />
        {/* IT WAS A BUTTON THAT DID NOTHING. No onClick at all, beside two invented rows — so the
            page looked finished and was inert. */}
        <button className="btn btn-sm btn-primary" onClick={() => setAdding(v => !v)}
          disabled={!isElectron}
          title={isElectron ? 'Add a knowledge entry' : 'The desktop app is needed to store entries'}>
          {adding ? 'Cancel' : '+ Add Entry'}
        </button>
      </div>

      {adding && (
        <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border)',
          background: 'var(--surface)', display: 'flex', gap: '8px', flexShrink: 0, flexWrap: 'wrap' }}>
          <input className="input" placeholder="Title" value={draft.title}
            onChange={e => setDraft({ ...draft, title: e.target.value })}
            style={{ flex: '1 1 200px' }} aria-label="Entry title" />
          <input className="input" placeholder="Tags, comma separated" value={draft.tags}
            onChange={e => setDraft({ ...draft, tags: e.target.value })}
            style={{ flex: '1 1 160px' }} aria-label="Entry tags" />
          <input className="input" placeholder="What is worth remembering" value={draft.content}
            onChange={e => setDraft({ ...draft, content: e.target.value })}
            style={{ flex: '2 1 280px' }} aria-label="Entry content" />
          <button className="btn btn-sm btn-primary" onClick={addEntry} disabled={!draft.title.trim()}>
            Save
          </button>
        </div>
      )}

      {error && (
        <div style={{ padding: '10px 20px', borderBottom: '1px solid var(--border)',
          background: 'rgba(255,80,80,0.06)', color: 'var(--red)',
          fontSize: FS.chrome, lineHeight: LH.chrome, flexShrink: 0 }} role="alert">
          {error}
        </div>
      )}

      {/* Search */}
      <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border)', background: 'var(--surface)', flexShrink: 0 }}>
        <input className="input" placeholder="Search knowledge..."
          value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {/* Entries */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px', display: 'flex', flexDirection: 'column', gap: '10px', minHeight: 0 }}>
        {/* THE EMPTY STATE PROMISED MONGODB, which this application does not use and has no
            dependency on — `buildMeaning` was still describing a mongodb version at one point. It now
            names the store that actually holds these entries, and tells the three empty cases apart:
            still loading, nothing stored, or a search that matched nothing. */}
        {loaded && entries.length === 0 && !error && (
          <div style={{ textAlign: 'center', color: 'var(--muted)', padding: '40px' }}>
            <div style={{ fontSize: '32px', marginBottom: '12px' }}>◉</div>
            <div style={{ fontSize: FS.chrome, lineHeight: LH.chrome }}>
              Nothing remembered yet.<br />
              Entries are stored encrypted in the <strong>knowledge</strong> domain of your local
              store — the same file set your passcode opens, re-keyed with everything else when you
              change it.
            </div>
          </div>
        )}
        {loaded && entries.length > 0 && filtered.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--muted)', padding: '40px',
            fontSize: FS.chrome, lineHeight: LH.chrome }}>
            {entries.length} {entries.length === 1 ? 'entry' : 'entries'} stored, none matching
            “{search.trim()}”.
          </div>
        )}
        {/* `_id` is what the store stamps; `entry.id` was the invented rows' own field and does not
            exist on a stored entry, so a key of `entry.id` would be undefined for every real row. */}
        {filtered.map(entry => (
          <div key={entry._id ?? entry.id} className="hud-card glow-hover" style={{ padding: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px', gap: '8px' }}>
              <div style={{ fontWeight: 700, color: 'var(--text)', fontSize: '13px' }}>{entry.title}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                <span style={{ fontSize: FS.chrome, lineHeight: LH.chrome, color: 'var(--muted)' }}>
                  {entry.ts ? new Date(entry.ts).toLocaleDateString() : '—'}
                </span>
                <button className="btn btn-sm" onClick={() => removeEntry(entry._id ?? entry.id)}
                  title="Remove this entry" aria-label={`Remove ${entry.title}`}>×</button>
              </div>
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-dim)', marginBottom: '10px', lineHeight: '1.6' }}>
              {entry.content ?? entry.excerpt ?? ''}
            </div>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {(Array.isArray(entry.tags) ? entry.tags : []).map(t => (
                <span key={t} className="badge badge-cyan" style={{ fontSize: FS.chrome, lineHeight: LH.chrome }}>{t}</span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
