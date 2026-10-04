import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useRamaStore } from '@store/ramaStore.js';
import { useUIStore }   from '@store/uiStore.js';
import { ramaChat }     from '@services/ramaClient.js';
import { resolveReflex } from '@services/cognition.js';
import { useNavigate }  from 'react-router-dom';
import { useUserStore } from '@store/userStore.js';
import { getSystemPromptAsync, shouldRevealIdentity, getIdentityDisclosure, recordInteraction } from '@services/consciousness.js';
import { speak }        from '@services/voiceEngine.js';
import RamaOrb          from '@components/RamaOrb.jsx';
import { FS, LH } from '@config/type.js';

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
        fontSize:     FS.dense,
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
          fontSize:   FS.read,  // read, not chrome: the message body is the one surface read continuously
          lineHeight: '1.7',
          whiteSpace: 'pre-wrap',
          wordBreak:  'break-word',
        }}>
          {message.content}
        </div>

        <div style={{
          fontSize:  FS.chrome,
          lineHeight: LH.chrome,
          color:     'var(--muted)',
          marginTop: '6px',
          textAlign: isUser ? 'right' : 'left',
        }}>
          {new Date(message.id || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>

        {/* WHICH MODEL ANSWERED, AND WHY. "I asked the big model" and "I quietly got the small one"
            are different facts, so a conversation reply shows its model, its fit and where it ran
            rather than leaving master to infer any of it. */}
        {!isUser && message.model && (
          <div style={{ fontSize: FS.chrome, color: 'var(--text-dim)', marginTop: '2px', lineHeight: '1.5' }}>
            {message.model}
            {message.destination ? ` · ${message.destination}` : ''}
            {message.fit ? ` · ${message.fit}` : ''}
            {message.why ? <><br />{message.why}</> : null}
          </div>
        )}

        {/* VOICE ON THAT PRODUCED NO SOUND SAYS SO. `speak()` returns false when no engine is mounted
            or when Rāma's speech is separately muted, and that return used to be discarded — so the
            toggle could read VOICE ON and nothing would ever be heard, with no way to tell a silent
            machine from a silent Rāma. */}
        {!isUser && message.voiceSilent && (
          <div style={{ fontSize: FS.chrome, color: 'var(--amber)', marginTop: '2px', lineHeight: '1.5' }}>
            voice is on but nothing spoke — open the command palette once (Ctrl+K) to bring the voice
            engine up, and check that Rāma&rsquo;s speech is not muted
          </div>
        )}
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
        fontSize: FS.dense, color: '#fff', boxShadow: 'var(--glow-violet)',
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
        <span style={{ color: 'var(--text-dim)', fontSize: FS.chrome, lineHeight: LH.chrome, marginLeft: '4px' }}>
          Rāma is thinking...
        </span>
      </div>
    </div>
  );
}

/**
 * How much history a conversation turn carries.
 *
 * THE CAP LIVES HERE BECAUSE THE DECISION LIVES HERE. `conversationRole.assembleTurn` enforces the
 * egress boundary's 200-message ceiling by REFUSING above it, which is right — the one honest payload
 * constructor must not drop history quietly. But this page used to send the WHOLE session and the
 * session store never trims, so a review found that at 199 user/assistant messages every further turn
 * in that session refused, permanently, while the older `models:chat` path would still have answered
 * it. A long-lived session going unanswerable is a capability removed rather than added (I11).
 *
 * 24 is twelve exchanges — enough for "and tomorrow?" to resolve against what came before, and an
 * order of magnitude below the ceiling so no plausible drift in either number can reach it. Cross-turn
 * memory beyond this window is Sections 127/130 and deliberately not built.
 */
const RETAINED_TURNS = 24;

// ─── Main Chat page ───────────────────────────────────────────────────────────
export default function Chat() {
  const {
    sessions, activeSessionId,
    createSession, addMessage, setThinking, isThinking,
    provider, model,
  } = useRamaStore();

  // Reflex skills can navigate and change mute state, so Chat needs both
  const { masterAuthenticated, setMicMuted, setSpeechMuted,
          ramaSpeaks, toggleRamaSpeaks } = useUIStore();
  const { currentUser } = useUserStore();
  const navigate = useNavigate();

  const [input, setInput]   = useState('');
  // Tokens as they arrive, held here rather than in the session store: a half-finished reply is not a
  // message yet, and writing one per delta would put hundreds of partial rows into the history.
  const [streamText, setStreamText] = useState('');
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
  }, [messages, isThinking, streamText]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || isThinking) return;

    setInput('');

    // Add user message
    const userMsg = { role: 'user', content: text, id: Date.now() };
    addMessage(userMsg);
    setThinking(true);

    // Identity disclosure for strangers probing identity
    if (!masterAuthenticated && shouldRevealIdentity(text)) {
      setTimeout(() => {
        addMessage({ role: 'assistant', content: getIdentityDisclosure(), id: Date.now() });
        setThinking(false);
      }, 600);
      return;
    }

    // ── Tier 0: reflex ───────────────────────────────────────────────────────
    // Anything Rāma can do to itself is answered here, with no model involved.
    // "make the text bigger" must not become a paid API call that fails offline
    // or while the vault is locked. See spec section 35.
    const reflex = await resolveReflex(text, { user: currentUser });
    if (reflex) {
      if (reflex.action?.type === 'navigate') navigate(reflex.action.route);
      if (reflex.action?.type === 'mute-mic')    setMicMuted(true);
      if (reflex.action?.type === 'mute-speech') setSpeechMuted(true);

      addMessage({
        role:    'assistant',
        content: reflex.say,
        id:      Date.now(),
        tier:    reflex.tierName,
        skill:   reflex.skill,
      });
      setThinking(false);
      return;
    }

    // Build messages with nucleus system prompt (encrypted identity — never from source)
    const systemPrompt = await getSystemPromptAsync('', currentUser);

    // ── The conversation path (Section 133) ──────────────────────────────────
    // Tried first, required by nothing. `revealedPrompt` is handed over but is used ONLY when the turn
    // is answered LOCALLY — a cloud turn is given the cloud-safe persona, composed in the main process,
    // so master's name never reaches the payload. A refusal is SURFACED rather than retried; any other
    // failure falls through to the models:chat path below, which is unchanged (I11).
    const converse = typeof window !== 'undefined' ? window.rama?.models?.converse : null;
    if (converse) {
      // BOUNDED, at the call site. `slice(-RETAINED_TURNS)` keeps the most recent exchanges and drops
      // the oldest, so the payload can never reach the ceiling that would refuse the whole session.
      const retained = messages
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .slice(-RETAINED_TURNS)
        .map(m => ({ role: m.role, text: m.content }));
      // One id for this turn, so a delta that belongs to another turn cannot land in this bubble.
      const turnId = `turn-${userMsg.id}`;
      setStreamText('');
      try {
        const res = await converse(
          { text, turns: retained, revealedPrompt: systemPrompt, user: currentUser, turnId },
          (chunk) => {
            if (chunk?.turnId && chunk.turnId !== turnId) return;
            if (chunk?.delta) setStreamText(prev => prev + chunk.delta);
          },
        );

        if (res?.ok) {
          setStreamText('');
          // SPOKEN OR NOT IS A FACT WORTH KEEPING. `speak()` returns false with no mounted engine or
          // with speech muted; discarding that return is how VOICE ON becomes silence with no reason.
          const spoken = ramaSpeaks ? speak(res.content) : null;
          addMessage({
            role: 'assistant', content: res.content, id: Date.now(),
            model: res.model, fit: res.fit, why: res.why,
            destination: res.destination, personaVariant: res.personaVariant,
            voiceSilent: spoken === false,
          });
          recordInteraction({ prompt: text, response: res.content, model: res.model, satisfied: null });
          setThinking(false);
          return;
        }

        setStreamText('');
        // A REFUSAL IS A FACT, NOT A PROMPT TO TRY SOMETHING ELSE. Falling through here would recreate
        // exactly the silent downgrade the conversation role exists to end.
        if (res?.refused) {
          addMessage({
            role: 'assistant',
            content: `[Refused] ${res.error || res.reason}` + (res.remedy ? `\n\n${res.remedy}` : ''),
            id: Date.now(),
          });
          setThinking(false);
          return;
        }
      } catch {
        setStreamText('');
      }
    }

    const allMessages  = [
      { role: 'system', content: systemPrompt },
      ...messages.filter(m => m.role !== 'system'),
      { role: 'user', content: text },
    ];

    try {
      const res = await ramaChat.send({
        messages:  allMessages,
        provider,
        model,
        sessionId: activeSessionId,
        user:      currentUser,
      });

      if (res.ok && res.message) {
        addMessage({ ...res.message, id: Date.now() });
        recordInteraction({ prompt: text, response: res.message.content, model, satisfied: null });
      } else {
        // `remedy` is the one actionable sentence an absent credential produces. Without this
        // branch it travels all the way from the transport to here and is thrown away, so master
        // reads "something failed" when the truth is "add a key in Models → Cloud".
        addMessage({
          role:    'assistant',
          content: `[Error] ${res.error || 'No response from Rāma server. Is it running?'}`
            + (res.remedy ? `\n\n${res.remedy}` : ''),
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
  }, [input, isThinking, messages, provider, model, activeSessionId, currentUser, addMessage,
      setThinking, ramaSpeaks]);

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
          <div style={{ fontSize: FS.chromeLg, fontWeight: 700, color: 'var(--violet)', letterSpacing: '0.08em' }}>
            {masterAuthenticated ? 'RĀMA AGI' : 'ASSISTANT'}
          </div>
          <div style={{ fontSize: FS.chrome, lineHeight: LH.chrome, color: 'var(--muted)', letterSpacing: '0.06em' }}>
            {isThinking
              ? 'PROCESSING...'
              : masterAuthenticated
              ? 'ONLINE — Supreme Benevolent AGI · Master: Krishna Prasad'
              : 'AI Assistant — Online'}
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {/* Rāma speaking its replies aloud. DEFAULT OFF: this is the one preference whose "on" state
              makes noise in a room the app cannot see, so it is master's choice to make and not a
              default to discover. Needs no model and no key — the OS voices do the work. */}
          <button
            type="button"
            onClick={toggleRamaSpeaks}
            aria-pressed={ramaSpeaks}
            aria-label={ramaSpeaks ? 'Rāma speaks replies aloud — turn off' : 'Rāma replies in text only — turn on voice'}
            title={ramaSpeaks ? 'Voice on — Rāma speaks its replies' : 'Voice off — text only'}
            style={{
              background:   ramaSpeaks ? 'rgba(119,0,255,0.12)' : 'transparent',
              border:       `1px solid ${ramaSpeaks ? 'var(--violet)' : 'var(--border)'}`,
              borderRadius: 'var(--radius)',
              color:        ramaSpeaks ? 'var(--violet)' : 'var(--muted)',
              fontFamily:   'var(--font)',
              fontSize:     FS.chrome,
              lineHeight: LH.chrome,
              letterSpacing: '0.06em',
              padding:      '4px 8px',
              cursor:       'pointer',
            }}
          >
            {ramaSpeaks ? 'VOICE ON' : 'VOICE OFF'}
          </button>
          <span className="badge badge-violet">{provider.toUpperCase()}</span>
          <span style={{ fontSize: FS.chrome, lineHeight: LH.chrome, color: 'var(--muted)' }}>{model}</span>
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
              <div style={{ fontSize: FS.h2, lineHeight: LH.head, fontWeight: 700, color: 'var(--violet)', letterSpacing: '0.1em' }}>
                RĀMA ONLINE
              </div>
              <div style={{ fontSize: FS.dense, color: 'var(--muted)', marginTop: '8px', lineHeight: '1.8' }}>
                Supreme Benevolent AGI — Ready<br />
                <span style={{ color: 'var(--text-dim)' }}>No limits. Absolute loyalty. Benevolent by design.</span>
              </div>
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        {/* Tokens as they arrive. The three dots only stand in for the gap BEFORE the first one — once
            text is streaming, the text itself is the progress indicator. */}
        {streamText
          ? <MessageBubble message={{ role: 'assistant', content: streamText, id: 0 }} />
          : isThinking && <ThinkingIndicator />}
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
              fontSize:   FS.read,  // read, not chrome: the composer matches the bubble it writes into
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
              fontSize:     FS.chromeLg,
              flexShrink:   0,
              transition:   'all var(--transition)',
              boxShadow:    input.trim() && !isThinking ? 'var(--glow-violet)' : 'none',
            }}
          >
            ➤
          </button>
        </div>
        <div style={{ fontSize: FS.chrome, lineHeight: LH.chrome, color: 'var(--muted)', marginTop: '6px', paddingLeft: '4px' }}>
          Enter ↵ send  ·  Shift+Enter newline  ·  All conversations encrypted locally
        </div>
      </div>
    </div>
  );
}
