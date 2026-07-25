import React, { useEffect, useRef, useState, useCallback } from 'react';
import { terminalClient } from '@services/ipcClient.js';

/**
 * Terminal page — wraps node-pty output in a simple xterm-style renderer.
 * Phase 3 will integrate xterm.js for full VT100 rendering.
 * This version provides a functional character-level terminal.
 */
export default function Terminal() {
  const [sessions, setSessions] = useState([]);  // { id, title, lines[] }
  const [activeId, setActiveId] = useState(null);
  const [input,    setInput]    = useState('');
  const outputRef               = useRef(null);
  const inputRef                = useRef(null);
  const [ptAvailable, setPtyAvailable] = useState(true);

  // Auto-scroll
  useEffect(() => {
    outputRef.current?.scrollTo(0, outputRef.current.scrollHeight);
  }, [sessions, activeId]);

  // Create initial session
  useEffect(() => {
    createSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const createSession = useCallback(async () => {
    const res = await terminalClient.create({ cols: 120, rows: 35 });

    if (!res.ok) {
      setPtyAvailable(false);
      const id = `sim_${Date.now()}`;
      setSessions(s => [...s, {
        id,
        title:  'Shell (Simulated)',
        lines:  [
          { type: 'sys', text: '⚠ node-pty not available. Install it and rebuild to enable full PTY.' },
          { type: 'sys', text: 'Simulated terminal mode active.' },
        ],
      }]);
      setActiveId(id);
      return;
    }

    const { id, shell } = res;
    const sessionTitle = `Shell (${shell?.split(/[/\\]/).pop() || 'sh'})`;

    // Accumulate output chunks
    const unsub = terminalClient.onData(id, (data) => {
      setSessions(s => s.map(sess =>
        sess.id !== id ? sess : {
          ...sess,
          lines: [...sess.lines, { type: 'out', text: data }].slice(-2000),
        }
      ));
    });

    const unsubExit = terminalClient.onExit?.(id, () => {
      setSessions(s => s.map(sess =>
        sess.id !== id ? sess : {
          ...sess,
          lines: [...sess.lines, { type: 'sys', text: `[Process exited]` }],
          exited: true,
        }
      ));
      unsub?.();
    });

    setSessions(s => [...s, {
      id,
      title: sessionTitle,
      lines: [{ type: 'sys', text: `Connected to ${shell}` }],
      cleanup: () => { unsub?.(); unsubExit?.(); },
    }]);
    setActiveId(id);
  }, []);

  const closeSession = useCallback(async (id) => {
    const sess = sessions.find(s => s.id === id);
    sess?.cleanup?.();
    await terminalClient.destroy(id);
    setSessions(s => s.filter(x => x.id !== id));
    setActiveId(prev => {
      if (prev !== id) return prev;
      const remaining = sessions.filter(x => x.id !== id);
      return remaining[remaining.length - 1]?.id ?? null;
    });
  }, [sessions]);

  const sendInput = useCallback((e) => {
    if (e.key === 'Enter') {
      const line = input;
      setInput('');
      if (!ptAvailable) {
        setSessions(s => s.map(sess =>
          sess.id !== activeId ? sess : {
            ...sess,
            lines: [...sess.lines, { type: 'in', text: `$ ${line}` }, { type: 'out', text: `[Simulated] Command not executed — node-pty required` }].slice(-2000),
          }
        ));
        return;
      }
      terminalClient.write(activeId, line + '\r');
    } else if (e.key === 'Tab') {
      e.preventDefault();
      if (ptAvailable && activeId) terminalClient.write(activeId, '\t');
    } else if (e.ctrlKey && e.key === 'c') {
      if (ptAvailable && activeId) terminalClient.write(activeId, '\x03');
    } else if (e.ctrlKey && e.key === 'l') {
      e.preventDefault();
      setSessions(s => s.map(sess => sess.id !== activeId ? sess : { ...sess, lines: [] }));
    }
  }, [input, activeId, ptAvailable]);

  const activeSession = sessions.find(s => s.id === activeId);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg)' }}>
      {/* Tab bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '0',
        borderBottom: '1px solid var(--border)', background: 'var(--surface)',
        flexShrink: 0, padding: '0 8px',
      }}>
        {sessions.map(sess => (
          <div key={sess.id} style={{ display: 'flex', alignItems: 'center' }}>
            <button onClick={() => setActiveId(sess.id)} style={{
              padding: '8px 14px', border: 'none', background: 'transparent',
              color: activeId === sess.id ? 'var(--green)' : 'var(--muted)',
              borderBottom: activeId === sess.id ? '2px solid var(--green)' : '2px solid transparent',
              cursor: 'pointer', fontFamily: 'var(--font)', fontSize: '11px',
            }}>
              {'>_'} {sess.title}
            </button>
            <button onClick={() => closeSession(sess.id)} style={{
              padding: '2px 6px', border: 'none', background: 'transparent',
              color: 'var(--muted)', cursor: 'pointer', fontSize: '10px', fontFamily: 'var(--font)',
            }}>✕</button>
          </div>
        ))}
        <button className="btn btn-sm" style={{ marginLeft: '8px', fontSize: '11px' }} onClick={createSession}>
          + New
        </button>
      </div>

      {/* Output */}
      <div
        ref={outputRef}
        onClick={() => inputRef.current?.focus()}
        style={{
          flex: 1, overflowY: 'auto', padding: '12px 16px', minHeight: 0,
          fontFamily: 'var(--font)', fontSize: '12px', lineHeight: '1.6',
          cursor: 'text', background: 'var(--bg)',
        }}
      >
        {activeSession?.lines.map((line, i) => (
          <div key={i} style={{
            color: line.type === 'sys'
              ? 'var(--muted)'
              : line.type === 'in'
              ? 'var(--accent)'
              : 'var(--text)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
          }}>
            {line.text}
          </div>
        ))}
        {!activeSession && (
          <div style={{ color: 'var(--muted)', padding: '20px', textAlign: 'center' }}>
            No terminal session — click "+ New" to start
          </div>
        )}
      </div>

      {/* Input row */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '8px',
        padding: '8px 16px', borderTop: '1px solid var(--border)',
        background: 'var(--surface)', flexShrink: 0,
      }}>
        <span style={{ color: 'var(--green)', fontSize: '12px', flexShrink: 0 }}>$</span>
        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={sendInput}
          placeholder="Type command... (Ctrl+C interrupt, Ctrl+L clear)"
          style={{
            flex: 1, background: 'transparent', border: 'none', outline: 'none',
            color: 'var(--text)', fontFamily: 'var(--font)', fontSize: '12px',
          }}
          autoFocus
        />
      </div>
    </div>
  );
}
