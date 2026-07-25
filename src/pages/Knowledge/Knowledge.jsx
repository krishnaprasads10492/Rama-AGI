import React, { useState } from 'react';

/**
 * Knowledge — Rāma's persistent memory and knowledge base.
 * Phase 5 will wire this to MongoDB for full CRUD + vector search.
 */
export default function Knowledge() {
  const [search, setSearch] = useState('');
  const [entries] = useState([
    { id: 1, title: 'System Architecture', tags: ['tech', 'design'], ts: Date.now() - 86400000, excerpt: 'Rāma is built on Electron + React + Node.js + Express...' },
    { id: 2, title: 'StockMind Integration', tags: ['stockmind', 'finance'], ts: Date.now() - 3600000, excerpt: 'StockMind runs as an assimilated module on port 4099...' },
  ]);

  const filtered = entries.filter(e =>
    e.title.toLowerCase().includes(search.toLowerCase()) ||
    e.excerpt.toLowerCase().includes(search.toLowerCase()) ||
    e.tags.some(t => t.includes(search.toLowerCase()))
  );

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', background: 'var(--surface)',
        display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
        <span style={{ fontWeight: 700, color: 'var(--accent)', letterSpacing: '0.1em' }}>KNOWLEDGE BASE</span>
        <span className="badge badge-cyan">RĀMA MEMORY</span>
        <div style={{ flex: 1 }} />
        <button className="btn btn-sm btn-primary">+ Add Entry</button>
      </div>

      {/* Search */}
      <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border)', background: 'var(--surface)', flexShrink: 0 }}>
        <input className="input" placeholder="Search knowledge..."
          value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {/* Entries */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px', display: 'flex', flexDirection: 'column', gap: '10px', minHeight: 0 }}>
        {filtered.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--muted)', padding: '40px' }}>
            <div style={{ fontSize: '32px', marginBottom: '12px' }}>◉</div>
            <div style={{ fontSize: '12px' }}>No knowledge entries yet.<br />Phase 5 will connect this to MongoDB for persistent memory.</div>
          </div>
        )}
        {filtered.map(entry => (
          <div key={entry.id} className="hud-card glow-hover" style={{ padding: '16px', cursor: 'pointer' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
              <div style={{ fontWeight: 700, color: 'var(--text)', fontSize: '13px' }}>{entry.title}</div>
              <span style={{ fontSize: '10px', color: 'var(--muted)' }}>{new Date(entry.ts).toLocaleDateString()}</span>
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-dim)', marginBottom: '10px', lineHeight: '1.6' }}>
              {entry.excerpt}
            </div>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {entry.tags.map(t => (
                <span key={t} className="badge badge-cyan" style={{ fontSize: '9px' }}>{t}</span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
