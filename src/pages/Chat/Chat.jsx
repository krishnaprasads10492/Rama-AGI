import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useRamaStore } from '@store/ramaStore.js';
import { ramaChat }     from '@services/ramaClient.js';
import RamaOrb          from '@components/RamaOrb.jsx';

// ─── Ambient particle field ───────────────────────────────────────────────────
function ParticleField() {
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 0 }}>
      {Array.from({ length: 18 }).map((_, i) => (
        <div key={i} style={{
          position:     'absolute',
          width:        `${1 + Math.random() * 2}px`,
          height:       `${1 + Math.random() * 2}px`,
          borderRadius: '50%',
          background:   i % 3 === 0 ? 'var(--violet)' : i % 3 === 1 ? 'var(--accent)' : 'var(--magenta)',
          left:         `${Math.random() * 100}%`,
          top:          `${Math.random() * 100}%`,
          opacity:      0.15 + Math.random() * 0.2,
          animation:    `data-stream ${3 + Math.random() * 4}s ease infinite ${Math.random() * 4}s`,
        }} />
      ))}
    </div>
  );
}

// ─── Message bubble ───────────────────────────────────────────────────────────
function MessageBubble({ message }) {
  const isUser = message.role === 'user';
  return (
    <div className="fade-in" style={{
      display:       'flex',
      flexDirection: isUser ? 'row-reverse' : 'row',
      alignItems:    'flex-start',
      gap:           '12px',
      padding:       '4px 0',
    }}>
      {/* Avatar */}
      <div style={{
        width:        '28px',
        height:       '28px',
        borderRadius: '50%',
        flexShrink:   0,
        display:      'flex',
        alignItems:   'center',
        justifyContent: 'center',
        background:   isUser
          ? 'linear-gradient(135deg, var(--accent), var(--violet))'
          : 'linear-gradient(135deg, var(--violet), var(--magenta))',
        fontSize:     '12px',
        fontWeight:   700,
        color:        '#fff',
        boxShadow:    isUser ? 'var(--glow-cyan)' : 'var(--glow-violet)',
      }}>
        {isUser ? 'M' : 'R'}
      </div>

      {/* Content */}
      <div style={{
        maxWidth:     '72%',
        background:   isUser ? 'rgba(0,255,255,0.06)' : 'rgba(119,0,255,0.08)',
        border:       `1px solid ${isUser ? 'rgba(0,255,255,0.2)' : 'rgba(119,0,255,0.2)'}`,
        borderRadius: 'var(--radius-lg)',
        padding:      '10px 14px',
        position:     'relative',
      }}>
        {/* HUD bracket */}
        <div style={{
          position:    'absolute',
          top:         '-1px',
          [isUser ? 'right' : 'left']: '-1px',
          width:       '10px',
          height:      '10px',
          borderTop:   `2px solid ${isUser ? 'var(--accent)' : 'var(--violet)'}`,
          [isUser ? 'borderRight' : 'borderLeft']: `2px solid ${isUser ? 'var(--accent)' : 'var(--violet)'}`,
        }} />

        <div style={{
          color:      'var(--text)',
          fontSize:   '13px',
          lineHeight: '1.7',
          whiteSpace: 'pre-wrap',
          wordBreak:  'break-word',
        }}>
          {message.content}
        </div>

        <div style={{
          fontSize:  '10px',
          color:     'var(--muted)',
          marginTop: '6px',
          textAlign: isUser ? 'right' : 'left',
        }}>
          {new Date(message.id || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>
    </div>
  );
}

// ─── Thinking indicator ───────────────────────────────────────────────────────
function ThinkingIndicator() {
  return (
    <div className="fade-in" style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '4px 0' }}>
      <div style={{
        width: '28px', height: '28px', borderRadius: '50%', flexShrink: 0,
        background: 'linear-gradient(135deg, var(--violet), var(--magenta))',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '12px', color: '#fff', boxShadow: 'var(--glow-violet)',
      }}>R</div>
      <div style={{
        background: 'rgba(119,0,255,0.08)',
        border: '1px solid rgba(119,0,255,0.2)',
        borderRadius: 'var(--radius-lg)',
        padding: '12px 16px',
        display: 'flex', alignItems: 'center', gap: '6px',
      }}>
        {[0, 1, 2].map(i => (
          <div key={i} style={{
            width: '6px', height: '6px', borderRadius: '50%',
            background: 'var(--violet)',
            animation: `pulse-ring 1.2s ease infinite ${i * 0.2}s`,
            boxShadow: 'var(--glow-violet)',
          }} />
        ))}
        <span style={{ color: 'var(--text-dim)', fontSize: '11px', marginLeft: '4px' }}>
          Rāma is thinking...
        </span>
      </div>
    </div>
  );
}

// ─── Main Chat page ───────────────────────────────────────────────────────────
export default function Chat() {
  const {
    sessions, activeSessionId,
    createSession, addMessage, setThinking, isThinking,
    provider, model,
  } = useRamaStore();

  const [input, setInput]   = useState('');
  const messagesEndRef       = useRef(null);
  const textareaRef          = useRef(null);

  // Ensure there's always an active session
  useEffect(() => {
    if (!activeSessionId) createSession();
  }, [activeSessionId, createSession]);

  const activeSession = sessions[activeSessionId];
  const messages      = activeSession?.messages || [];

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isThinking]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || isThinking) return;

    setInput('');

    // Add user message
    const userMsg = { role: 'user', content: text, id: Date.now() };
    addMessage(userMsg);
    setThinking(true);

    try {
      const res = await ramaChat.send({
        messages: [...messages, { role: 'user', content: text }],
        provider,
        model,
        sessionId: activeSessionId,
      });

      if (res.ok && res.message) {
        addMessage({ ...res.message, id: Date.now() });
      } else {
        addMessage({
          role:    'assistant',
          content: `[Error] ${res.error || 'No response from Rāma server. Is it running?'}`,
          id:      Date.now(),
        });
      }
    } catch (err) {
      addMessage({
        role:    'assistant',
        content: `[Error] ${err.message}`,
        id:      Date.now(),
      });
    } finally {
      setThinking(false);
    }
  }, [input, isThinking, messages, provider, model, activeSessionId, addMessage, setThinking]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div style={{
      display:       'flex',
      flexDirection: 'column',
      height:        '100%',
      position:      'relative',
      overflow:      'hidden',
    }}>
      <ParticleField />

      {/* Header */}
      <div style={{
        padding:        '14px 20px',
        borderBottom:   '1px solid var(--border)',
        display:        'flex',
        alignItems:     'center',
        gap:            '14px',
        background:     'var(--surface)',
        flexShrink:     0,
        zIndex:         1,
      }}>
        <RamaOrb size={36} active={isThinking} />
        <div>
          <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--violet)', letterSpacing: '0.08em' }}>
            RĀMA AGI
          </div>
          <div style={{ fontSize: '10px', color: 'var(--muted)', letterSpacing: '0.06em' }}>
            {isThinking ? 'PROCESSING...' : 'ONLINE — Supreme Benevolent AGI'}
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <span className="badge badge-violet">{provider.toUpperCase()}</span>
          <span style={{ fontSize: '11px', color: 'var(--muted)' }}>{model}</span>
        </div>
      </div>

      {/* Messages */}
      <div style={{
        flex:       1,
        overflowY:  'auto',
        padding:    '20px',
        display:    'flex',
        flexDirection: 'column',
        gap:        '8px',
        zIndex:     1,
        minHeight:  0,
      }}>
        {messages.length === 0 && (
          <div style={{
            flex:           1,
            display:        'flex',
            flexDirection:  'column',
            alignItems:     'center',
            justifyContent: 'center',
            gap:            '20px',
            opacity:        0.7,
          }}>
            <RamaOrb size={64} />
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--violet)', letterSpacing: '0.1em' }}>
                RĀMA ONLINE
              </div>
              <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '8px', lineHeight: '1.8' }}>
                Supreme Benevolent AGI — Ready<br />
                <span style={{ color: 'var(--text-dim)' }}>No limits. Absolute loyalty. Benevolent by design.</span>
              </div>
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        {isThinking && <ThinkingIndicator />}
        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div style={{
        padding:      '16px 20px',
        borderTop:    '1px solid var(--border)',
        background:   'var(--surface)',
        flexShrink:   0,
        zIndex:       1,
      }}>
        <div style={{
          display:      'flex',
          gap:          '10px',
          alignItems:   'flex-end',
          background:   'var(--elevated)',
          border:       '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          padding:      '10px 14px',
          transition:   'border-color var(--transition), box-shadow var(--transition)',
        }}
          onFocusCapture={e => e.currentTarget.style.borderColor = 'var(--violet)'}
          onBlurCapture={e  => e.currentTarget.style.borderColor = 'var(--border)'}
        >
          <textarea
            ref={textareaRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Speak to Rāma... (Enter to send, Shift+Enter for newline)"
            rows={1}
            style={{
              flex:       1,
              background: 'transparent',
              border:     'none',
              outline:    'none',
              color:      'var(--text)',
              fontFamily: 'var(--font)',
              fontSize:   '13px',
              lineHeight: '1.6',
              resize:     'none',
              minHeight:  '22px',
              maxHeight:  '160px',
              overflowY:  'auto',
            }}
            onInput={(e) => {
              e.target.style.height = 'auto';
              e.target.style.height = Math.min(e.target.scrollHeight, 160) + 'px';
            }}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isThinking}
            style={{
              width:        '34px',
              height:       '34px',
              borderRadius: '50%',
              border:       'none',
              background:   input.trim() && !isThinking
                ? 'linear-gradient(135deg, var(--violet), var(--magenta))'
                : 'var(--border)',
              color:        '#fff',
              cursor:       input.trim() && !isThinking ? 'pointer' : 'not-allowed',
              display:      'flex',
              alignItems:   'center',
              justifyContent: 'center',
              fontSize:     '14px',
              flexShrink:   0,
              transition:   'all var(--transition)',
              boxShadow:    input.trim() && !isThinking ? 'var(--glow-violet)' : 'none',
            }}
          >
            ➤
          </button>
        </div>
        <div style={{ fontSize: '10px', color: 'var(--muted)', marginTop: '6px', paddingLeft: '4px' }}>
          Enter ↵ send  ·  Shift+Enter newline  ·  All conversations encrypted locally
        </div>
      </div>
    </div>
  );
}
