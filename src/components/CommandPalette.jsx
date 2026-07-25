import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useUIStore }   from '@store/uiStore.js';
import { useRamaStore } from '@store/ramaStore.js';
import { VoiceEngine }  from '@services/voiceEngine.js';
import { isMasterAuthenticated } from '@services/consciousness.js';

// Pages come from the single registry — see src/config/registry.js
import { visiblePages, searchPages } from '@config/registry.js';
import { useUserStore } from '@store/userStore.js';

// ─── Voice mic button ─────────────────────────────────────────────────────────
function VoiceMicBtn({ active, onToggle }) {
  return (
    <button
      onClick={onToggle}
      title={active ? 'Stop listening' : 'Start voice (Hey Rāma...)'}
      style={{
        width:        '32px',
        height:       '32px',
        borderRadius: '50%',
        border:       `1px solid ${active ? 'var(--magenta)' : 'var(--border)'}`,
        background:   active ? 'rgba(255,0,170,0.15)' : 'transparent',
        color:        active ? 'var(--magenta)' : 'var(--muted)',
        cursor:       'pointer',
        display:      'flex',
        alignItems:   'center',
        justifyContent: 'center',
        fontSize:     '14px',
        flexShrink:   0,
        transition:   'all 0.15s',
        boxShadow:    active ? 'var(--glow-magenta)' : 'none',
        animation:    active ? 'pulse-ring 1.5s ease infinite' : 'none',
      }}
    >
      🎙
    </button>
  );
}

// ─── Page tab button ──────────────────────────────────────────────────────────
function PageTab({ page, active, onClick }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={page.desc}
      style={{
        display:      'flex',
        flexDirection:'column',
        alignItems:   'center',
        gap:          '3px',
        padding:      '8px 14px',
        border:       'none',
        background:   active
          ? `rgba(${colorToRgb(page.color)}, 0.1)`
          : hover
          ? 'rgba(0,255,255,0.04)'
          : 'transparent',
        borderBottom: active
          ? `2px solid ${page.color}`
          : '2px solid transparent',
        color:        active ? page.color : hover ? 'var(--text)' : 'var(--text-dim)',
        cursor:       'pointer',
        fontFamily:   'var(--font)',
        fontSize:     '10px',
        letterSpacing:'0.06em',
        transition:   'all 0.15s',
        flexShrink:   0,
        minWidth:     '60px',
        whiteSpace:   'nowrap',
      }}
    >
      <span style={{
        fontSize:   '15px',
        textShadow: active ? `0 0 8px ${page.color}` : 'none',
        filter:     active ? `drop-shadow(0 0 4px ${page.color})` : 'none',
        transition: 'all 0.15s',
      }}>
        {page.icon}
      </span>
      <span>{page.label}</span>
    </button>
  );
}

// ─── Search results dropdown ──────────────────────────────────────────────────
function SearchResults({ query, pages, onSelect }) {
  if (!query) return null;
  const results = searchPages(query, pages);
  if (results.length === 0) return null;

  return (
    <div style={{
      position:   'absolute',
      top:        '100%',
      left:       '50%',
      transform:  'translateX(-50%)',
      width:      '400px',
      background: 'var(--elevated)',
      border:     '1px solid var(--border)',
      borderTop:  'none',
      borderRadius:'0 0 var(--radius-lg) var(--radius-lg)',
      zIndex:     200,
      overflow:   'hidden',
      boxShadow:  '0 8px 32px rgba(0,0,0,0.5)',
    }}>
      {results.map(p => (
        <div key={p.route} onClick={() => onSelect(p.route)}
          style={{
            display:     'flex',
            alignItems:  'center',
            gap:         '12px',
            padding:     '10px 16px',
            cursor:      'pointer',
            borderBottom:'1px solid var(--border)',
            transition:  'background 0.1s',
          }}
          onMouseEnter={e => e.currentTarget.style.background = 'rgba(0,255,255,0.05)'}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
        >
          <span style={{ color: p.color, fontSize: '16px', minWidth: '20px', textAlign: 'center' }}>{p.icon}</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: '12px', color: 'var(--text)' }}>{p.label}</div>
            <div style={{ fontSize: '10px', color: 'var(--muted)' }}>{p.desc}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Voice transcript HUD ─────────────────────────────────────────────────────
function VoiceHUD({ transcript, wakeActive }) {
  if (!transcript && !wakeActive) return null;
  return (
    <div style={{
      position:   'fixed',
      bottom:     '24px',
      left:       '50%',
      transform:  'translateX(-50%)',
      background: 'rgba(255,0,170,0.15)',
      border:     '1px solid rgba(255,0,170,0.5)',
      borderRadius:'var(--radius-lg)',
      padding:    '8px 20px',
      color:      wakeActive ? 'var(--magenta)' : 'var(--text-dim)',
      fontSize:   '12px',
      zIndex:     9000,
      backdropFilter: 'blur(8px)',
      boxShadow:  'var(--glow-magenta)',
      display:    'flex',
      alignItems: 'center',
      gap:        '10px',
      animation:  'fadeIn 0.2s ease',
    }}>
      <div style={{
        width: '8px', height: '8px', borderRadius: '50%',
        background: 'var(--magenta)',
        animation: 'pulse-ring 1s ease infinite',
        boxShadow: 'var(--glow-magenta)',
      }} />
      {wakeActive ? '🎙 Rāma is listening...' : transcript}
    </div>
  );
}

// ─── Self-modify modal ────────────────────────────────────────────────────────
function SelfModifyModal({ mod, onApprove, onDeny }) {
  if (!mod) return null;
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 800,
    }}>
      <div className="hud-card" style={{ width: '600px', maxHeight: '70vh', display: 'flex', flexDirection: 'column', padding: '24px', gap: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ color: 'var(--amber)', fontWeight: 700, letterSpacing: '0.08em' }}>
            ⚡ RĀMA SELF-MODIFICATION REQUEST
          </span>
          {mod.requiresRestart && (
            <span className="badge badge-red" style={{ fontSize: '9px' }}>REQUIRES RESTART</span>
          )}
        </div>
        <div style={{ color: 'var(--text)', fontSize: '13px' }}>{mod.description}</div>
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {mod.files.map((f, i) => (
            <div key={i} style={{ marginBottom: '12px' }}>
              <div style={{ fontSize: '11px', color: 'var(--accent)', marginBottom: '4px', fontWeight: 700 }}>
                {f.action.toUpperCase()}: {f.path}
              </div>
              {f.content && (
                <pre style={{
                  background: 'var(--surface)', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)', padding: '10px', fontSize: '11px',
                  color: 'var(--text-dim)', overflow: 'auto', maxHeight: '200px',
                  whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                }}>
                  {f.content.slice(0, 2000)}{f.content.length > 2000 ? '\n... [truncated]' : ''}
                </pre>
              )}
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <button className="btn btn-sm btn-danger" onClick={onDeny}>✕ Deny</button>
          <button className="btn btn-sm btn-primary" onClick={onApprove}>✓ Approve & Apply</button>
        </div>
      </div>
    </div>
  );
}

// ─── Main CommandPalette ──────────────────────────────────────────────────────
export default function CommandPalette({ extraPages = [] }) {
  const navigate = useNavigate();
  const location = useLocation();

  const {
    paletteOpen, paletteQuery,
    openPalette, closePalette, setPaletteQuery,
    pushRecent, recentPages,
    voiceActive, setVoiceActive, setVoiceWakeReady, setLastVoiceCmd,
    pendingModification, clearPendingMod,
    masterAuthenticated,
  } = useUIStore();

  const { addMessage, activeSessionId, createSession } = useRamaStore();

  const inputRef      = useRef(null);
  const voiceRef      = useRef(null);
  const [voiceTranscript, setVoiceTranscript] = useState('');
  const [wakeActive,      setWakeActive]      = useState(false);

  const { currentUser } = useUserStore();

  // Tabs/search come from the registry, filtered by the current user's tier.
  // `extraPages` lets Rāma surface self-created pages before a restart.
  const allPages = React.useMemo(
    () => [...visiblePages(currentUser), ...extraPages],
    [currentUser, extraPages]
  );

  // ── Keyboard: Ctrl+K toggle ──────────────────────────────────────────────
  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        paletteOpen ? closePalette() : openPalette();
      }
      if (e.key === 'Escape' && paletteOpen) closePalette();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [paletteOpen, openPalette, closePalette]);

  // ── Focus input when palette opens ──────────────────────────────────────
  useEffect(() => {
    if (paletteOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [paletteOpen]);

  // ── Navigate handler ─────────────────────────────────────────────────────
  const goTo = useCallback((route, label) => {
    navigate(route);
    pushRecent(route, label || allPages.find(p => p.route === route)?.label || route);
    closePalette();
    setWakeActive(false);
  }, [navigate, pushRecent, closePalette, allPages]);

  // ── Voice engine setup ───────────────────────────────────────────────────
  useEffect(() => {
    const engine = new VoiceEngine({
      onWake: (transcript) => {
        setWakeActive(true);
        openPalette();
        setTimeout(() => setWakeActive(false), 8000);
      },
      onTranscript: (t, isFinal) => {
        setVoiceTranscript(t);
        if (isFinal) setTimeout(() => setVoiceTranscript(''), 2000);
      },
      onCommand: (matched, command, raw) => {
        setLastVoiceCmd(command);
        setWakeActive(false);
        if (matched.route) {
          goTo(matched.route);
        } else if (matched.action === 'close-palette') {
          closePalette();
        } else if (matched.action === 'open-palette') {
          openPalette();
        } else if (matched.action === 'inject-message') {
          if (!activeSessionId) createSession();
          addMessage({ role: 'user', content: matched.message, id: Date.now() });
          navigate('/');
          closePalette();
        }
      },
      onError: (err) => console.warn('[voice]', err),
      onReady: () => setVoiceWakeReady(true),
    });

    voiceRef.current = engine;
    engine.init();
    // Auto-start passive listening for wake word
    engine.start();
    setVoiceActive(true);

    return () => engine.stop();
  }, []);  // eslint-disable-line

  const toggleVoice = useCallback(() => {
    const engine = voiceRef.current;
    if (!engine) return;
    if (voiceActive) {
      engine.stop();
      setVoiceActive(false);
    } else {
      engine.start();
      setVoiceActive(true);
    }
  }, [voiceActive, setVoiceActive]);

  // ── Self-modify handlers ─────────────────────────────────────────────────
  const handleApproveModification = useCallback(async () => {
    if (!pendingModification) return;
    const { applyModification } = await import('@services/selfModify.js');
    const result = await applyModification(pendingModification);
    if (result.ok) {
      clearPendingMod();
      // Vite HMR handles reload for UI changes
    }
  }, [pendingModification, clearPendingMod]);

  const activePage = allPages.find(p =>
    p.route === location.pathname ||
    (p.route !== '/' && location.pathname.startsWith(p.route))
  );

  return (
    <>
      {/* Self-modify approval modal */}
      <SelfModifyModal
        mod={pendingModification}
        onApprove={handleApproveModification}
        onDeny={clearPendingMod}
      />

      {/* Voice HUD */}
      <VoiceHUD transcript={voiceTranscript} wakeActive={wakeActive} />

      {/* Command palette container */}
      <div style={{
        background:   'var(--surface)',
        borderBottom: paletteOpen ? '1px solid var(--border)' : '1px solid transparent',
        overflow:     'hidden',
        flexShrink:   0,
        transition:   'all 0.25s ease',
        maxHeight:    paletteOpen ? '160px' : '0',
        opacity:      paletteOpen ? 1 : 0,
        zIndex:       100,
        position:     'relative',
      }}>
        {/* Search row */}
        <div style={{
          display:    'flex',
          alignItems: 'center',
          gap:        '10px',
          padding:    '10px 16px',
          borderBottom: '1px solid var(--border)',
        }}>
          <span style={{ color: 'var(--muted)', fontSize: '13px', flexShrink: 0 }}>⌕</span>
          <input
            ref={inputRef}
            value={paletteQuery}
            onChange={e => setPaletteQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                const results = searchPages(paletteQuery, allPages);
                if (results[0]) goTo(results[0].route, results[0].label);
              }
              if (e.key === 'Escape') closePalette();
            }}
            placeholder={
              masterAuthenticated
                ? 'Command Rāma... or navigate (Ctrl+K to toggle)'
                : 'Search pages... (Ctrl+K to toggle)'
            }
            style={{
              flex:       1,
              background: 'transparent',
              border:     'none',
              outline:    'none',
              color:      'var(--text)',
              fontFamily: 'var(--font)',
              fontSize:   '13px',
            }}
          />
          <VoiceMicBtn active={voiceActive} onToggle={toggleVoice} />
          <button className="btn btn-sm" onClick={closePalette}
            style={{ fontSize: '11px', padding: '3px 8px' }}>
            ESC
          </button>

          {/* Search results dropdown */}
          <SearchResults
            query={paletteQuery}
            pages={allPages}
            onSelect={(route) => goTo(route)}
          />
        </div>

        {/* Page tabs row */}
        <div style={{
          display:     'flex',
          alignItems:  'center',
          overflowX:   'auto',
          padding:     '0',
          gap:         '0',
          scrollbarWidth: 'none',
        }}>
          {allPages.map(page => (
            <PageTab
              key={page.route}
              page={page}
              active={activePage?.route === page.route}
              onClick={() => goTo(page.route, page.label)}
            />
          ))}
        </div>
      </div>

      {/* Palette toggle strip — always visible at top of content ──────────── */}
      <div
        onClick={() => paletteOpen ? closePalette() : openPalette()}
        style={{
          height:         '3px',
          background:     paletteOpen
            ? `linear-gradient(90deg, var(--violet), var(--accent), var(--magenta))`
            : 'var(--border)',
          cursor:         'pointer',
          transition:     'background 0.3s',
          flexShrink:     0,
          boxShadow:      paletteOpen ? '0 0 8px rgba(0,255,255,0.4)' : 'none',
        }}
        title={paletteOpen ? 'Close command palette' : 'Open command palette (Ctrl+K)'}
      />
    </>
  );
}

// ── Helper ─────────────────────────────────────────────────────────────────────
function colorToRgb(cssVar) {
  const map = {
    'var(--violet)':  '119,0,255',
    'var(--accent)':  '0,200,255',
    'var(--green)':   '0,255,65',
    'var(--magenta)': '255,0,170',
    'var(--amber)':   '255,170,0',
    'var(--gold)':    '212,169,64',
    'var(--red)':     '255,0,60',
    'var(--muted)':   '120,140,160',
  };
  return map[cssVar] || '0,200,255';
}
