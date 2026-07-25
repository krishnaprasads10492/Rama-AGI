import React, { useEffect, useState, useRef } from 'react';

/**
 * ActivityStream — Live feed of everything Rāma is doing.
 * Agentic UX research finding: users trust AI more when they can see
 * what it's doing in real time (Amazon Science, Smashing 2026).
 *
 * Floats as an overlay on the right side, toggleable.
 */

const STREAM_TYPES = {
  thinking:   { color: 'var(--violet)',  icon: '◈' },
  action:     { color: 'var(--accent)',  icon: '⚡' },
  tool:       { color: 'var(--green)',   icon: '⬢' },
  agent:      { color: 'var(--magenta)', icon: '◎' },
  memory:     { color: 'var(--violet)',  icon: '◉' },
  system:     { color: 'var(--text-dim)',icon: '·'  },
  alert:      { color: 'var(--amber)',   icon: '⚠'  },
  error:      { color: 'var(--red)',     icon: '✕'  },
  complete:   { color: 'var(--green)',   icon: '✓'  },
};

// Global event bus for activity stream
const listeners = new Set();
export function emitActivity(type, message, meta = {}) {
  const entry = { id: Date.now() + Math.random(), type, message, meta, ts: Date.now() };
  listeners.forEach(fn => fn(entry));
}

function useActivityStream(maxItems = 80) {
  const [entries, setEntries] = useState([]);
  useEffect(() => {
    const handler = (entry) => {
      setEntries(prev => [entry, ...prev].slice(0, maxItems));
    };
    listeners.add(handler);
    return () => listeners.delete(handler);
  }, [maxItems]);
  return entries;
}

export default function ActivityStream({ visible, onToggle }) {
  const entries  = useActivityStream();
  const listRef  = useRef(null);

  if (!visible) {
    return (
      <button onClick={onToggle} style={{
        position:     'fixed',
        right:        '12px',
        bottom:       '12px',
        width:        '36px',
        height:       '36px',
        borderRadius: '50%',
        border:       '1px solid var(--border)',
        background:   'var(--surface)',
        color:        entries.length > 0 ? 'var(--accent)' : 'var(--muted)',
        cursor:       'pointer',
        fontSize:     '14px',
        display:      'flex',
        alignItems:   'center',
        justifyContent: 'center',
        zIndex:       400,
        boxShadow:    entries.length > 0 ? 'var(--glow-cyan)' : 'none',
        transition:   'all 0.2s',
      }} title="Show activity stream">
        ⬢
        {entries.length > 0 && (
          <div style={{
            position:     'absolute',
            top:          '-3px',
            right:        '-3px',
            width:        '10px',
            height:       '10px',
            borderRadius: '50%',
            background:   'var(--accent)',
            boxShadow:    'var(--glow-cyan)',
            animation:    'pulse-ring 1.5s ease infinite',
          }} />
        )}
      </button>
    );
  }

  return (
    <div style={{
      position:     'fixed',
      right:        '12px',
      bottom:       '12px',
      width:        '320px',
      maxHeight:    '480px',
      background:   'rgba(5,13,21,0.95)',
      border:       '1px solid var(--border)',
      borderRadius: 'var(--radius-lg)',
      display:      'flex',
      flexDirection:'column',
      zIndex:       400,
      backdropFilter: 'blur(12px)',
      boxShadow:    '0 8px 40px rgba(0,0,0,0.6)',
      overflow:     'hidden',
    }}>
      {/* Header */}
      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--accent)',
            boxShadow: 'var(--glow-cyan)', animation: 'pulse-ring 1.5s ease infinite' }} />
          <span style={{ fontSize: '10px', fontWeight: 700, color: 'var(--accent)', letterSpacing: '0.1em' }}>
            ACTIVITY STREAM
          </span>
        </div>
        <button onClick={onToggle} style={{ background: 'none', border: 'none', color: 'var(--muted)',
          cursor: 'pointer', fontSize: '12px', fontFamily: 'var(--font)' }}>✕</button>
      </div>

      {/* Entries */}
      <div ref={listRef} style={{ flex: 1, overflowY: 'auto', padding: '6px 0' }}>
        {entries.length === 0 ? (
          <div style={{ padding: '20px', textAlign: 'center', color: 'var(--muted)', fontSize: '11px' }}>
            Rāma is idle. Activity appears here in real time.
          </div>
        ) : entries.map(entry => {
          const style = STREAM_TYPES[entry.type] || STREAM_TYPES.system;
          return (
            <div key={entry.id} className="fade-in" style={{
              display:    'flex',
              alignItems: 'flex-start',
              gap:        '8px',
              padding:    '5px 14px',
              transition: 'background 0.1s',
            }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(0,255,255,0.03)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <span style={{ color: style.color, fontSize: '11px', flexShrink: 0, marginTop: '1px' }}>
                {style.icon}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '11px', color: style.color === 'var(--text-dim)' ? 'var(--text-dim)' : 'var(--text)',
                  lineHeight: '1.5', wordBreak: 'break-word' }}>
                  {entry.message}
                </div>
                <div style={{ fontSize: '9px', color: 'var(--muted)', marginTop: '1px' }}>
                  {new Date(entry.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  {entry.meta?.model && ` · ${entry.meta.model}`}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
