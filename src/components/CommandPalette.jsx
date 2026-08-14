import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useUIStore }   from '@store/uiStore.js';
import { useRamaStore } from '@store/ramaStore.js';
import {
  VoiceEngine, MIC_MODES, MIC_MODE_LABELS, modesForLevel,
} from '@services/voiceEngine.js';


// Pages come from the single registry — see src/config/registry.js
import { visiblePages, searchPages } from '@config/registry.js';
import { useUserStore } from '@store/userStore.js';

// ─── Voice mic button ─────────────────────────────────────────────────────────
/**
 * Reports the live voice level and, on hover, exactly what the next level needs.
 * A capability that is silently absent is a bug regardless of the reason, so this
 * never renders as a plain dead button.
 */
/**
 * Click toggles mic mute. Hold is push-to-talk and works regardless of mode — a
 * direct request should always be honoured. Right-click opens the mode menu.
 */
function VoiceMicBtn({ capability, recording, micMuted, mode, onToggleMute, onPressStart, onPressEnd, onOpenModes }) {
  const level    = capability?.level ?? 0;
  const canVoice = level >= 1;
  const held     = useRef(false);
  const timer    = useRef(null);

  const title = !canVoice
    ? `Voice unavailable — ${capability?.nextStep ?? 'use Ctrl+K for typed commands'}`
    : micMuted
      ? 'Mic muted — click or Ctrl+Shift+M to unmute'
      : `${capability.levelName} · ${MIC_MODE_LABELS[mode] ?? mode} · click to mute, hold to speak, right-click for modes`;

  // Distinguish a click from a hold: 220ms decides
  const handlers = canVoice ? {
    onMouseDown: () => {
      held.current = false;
      timer.current = setTimeout(async () => { held.current = true; await onPressStart?.(); }, 220);
    },
    onMouseUp: async () => {
      clearTimeout(timer.current);
      if (held.current) { held.current = false; await onPressEnd?.(); }
      else onToggleMute?.();
    },
    onMouseLeave: async () => {
      clearTimeout(timer.current);
      if (held.current) { held.current = false; await onPressEnd?.(); }
    },
    onContextMenu: (e) => { e.preventDefault(); onOpenModes?.(); },
  } : {};

  const live   = recording || (!micMuted && mode !== MIC_MODES.OFF && level >= 2);
  const colour = !canVoice ? 'var(--muted)'
               : micMuted  ? 'var(--red)'
               : recording ? 'var(--red)'
               : live      ? 'var(--magenta)'
               : 'var(--muted)';

  return (
    <button
      {...handlers}
      disabled={!canVoice}
      title={title}
      aria-label={title}
      aria-pressed={!micMuted}
      style={{
        width:        '32px',
        height:       '32px',
        borderRadius: '50%',
        border:       `1px solid ${live ? colour : 'var(--border)'}`,
        background:   recording ? 'rgba(255,0,60,0.18)' : live ? 'rgba(255,0,170,0.15)' : 'transparent',
        color:        colour,
        cursor:       canVoice ? 'pointer' : 'not-allowed',
        display:      'flex',
        alignItems:   'center',
        justifyContent: 'center',
        fontSize:     '14px',
        flexShrink:   0,
        transition:   'all 0.15s',
        opacity:      canVoice ? 1 : 0.45,
        boxShadow:    live ? (recording ? '0 0 10px rgba(255,0,60,0.5)' : 'var(--glow-magenta)') : 'none',
        animation:    (recording || (live && !micMuted && mode === MIC_MODES.WAKE)) ? 'pulse-ring 1.5s ease infinite' : 'none',
      }}
    >
      {!canVoice ? '🚫' : micMuted ? '🔇' : '🎙'}
    </button>
  );
}

// ─── Speech output mute ───────────────────────────────────────────────────────
/** Independent of the mic: silencing Rāma's replies must not stop it hearing. */
function SpeechMuteBtn({ muted, onToggle }) {
  return (
    <button
      onClick={onToggle}
      title={muted ? 'Rāma is silent — click or Ctrl+Shift+S to let it speak' : 'Rāma speaks — click to silence'}
      aria-label={muted ? 'Unmute Rāma speech' : 'Mute Rāma speech'}
      aria-pressed={muted}
      style={{
        width: '28px', height: '28px', borderRadius: '50%',
        border: `1px solid ${muted ? 'var(--amber)' : 'var(--border)'}`,
        background: muted ? 'rgba(255,170,0,0.12)' : 'transparent',
        color: muted ? 'var(--amber)' : 'var(--muted)',
        cursor: 'pointer', display: 'flex', alignItems: 'center',
        justifyContent: 'center', fontSize: '12px', flexShrink: 0,
        transition: 'all 0.15s',
      }}
    >
      {muted ? '🔕' : '🔔'}
    </button>
  );
}

// ─── Mic mode menu ────────────────────────────────────────────────────────────
/** Only modes this machine can deliver are offered; the rest say what they need. */
function MicModeMenu({ open, capability, mode, onPick, onClose }) {
  if (!open) return null;

  const available = modesForLevel(capability);
  const all = [MIC_MODES.OFF, MIC_MODES.PTT, MIC_MODES.HANDS_FREE, MIC_MODES.WAKE];

  const why = {
    [MIC_MODES.HANDS_FREE]: 'needs a transcription backend',
    [MIC_MODES.WAKE]:       'needs a local speech engine',
    [MIC_MODES.PTT]:        'needs microphone access',
  };

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 300 }} />
      <div style={{
        position: 'absolute', top: '100%', right: '52px', marginTop: '4px',
        background: 'var(--elevated)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius)', zIndex: 301, minWidth: '210px',
        boxShadow: '0 8px 28px rgba(0,0,0,0.55)', overflow: 'hidden',
      }}>
        <div style={{
          padding: '7px 12px', fontSize: '9px', letterSpacing: '0.1em',
          color: 'var(--muted)', borderBottom: '1px solid var(--border)',
        }}>
          MICROPHONE MODE
        </div>
        {all.map(m => {
          const enabled = available.includes(m);
          const active  = mode === m;
          return (
            <div
              key={m}
              onClick={() => enabled && onPick(m)}
              title={enabled ? '' : why[m]}
              style={{
                padding: '8px 12px', fontSize: '11px',
                cursor: enabled ? 'pointer' : 'not-allowed',
                opacity: enabled ? 1 : 0.4,
                color: active ? 'var(--accent)' : 'var(--text-dim)',
                background: active ? 'rgba(0,200,255,0.08)' : 'transparent',
                display: 'flex', alignItems: 'center', gap: '8px',
              }}
            >
              <span style={{ width: '10px' }}>{active ? '●' : ''}</span>
              <span style={{ flex: 1 }}>{MIC_MODE_LABELS[m]}</span>
              {!enabled && <span style={{ fontSize: '8px', color: 'var(--muted)' }}>unavailable</span>}
            </div>
          );
        })}
      </div>
    </>
  );
}

// ─── Voice level chip ─────────────────────────────────────────────────────────
/** Makes the ladder visible: which level voice is on, and how to climb. */
function VoiceLevelChip({ capability, onRescan }) {
  if (!capability) return null;

  const level  = capability.level ?? 0;
  const colour = level >= 4 ? 'var(--green)'
               : level >= 2 ? 'var(--accent)'
               : level >= 1 ? 'var(--amber)'
               : 'var(--muted)';

  return (
    <span
      onClick={onRescan}
      title={capability.nextStep
        ? `Voice level ${level}/4 — to climb: ${capability.nextStep}. Click to re-check.`
        : `Voice level ${level}/4 — highest available. Click to re-check.`}
      style={{
        fontSize: '9px', letterSpacing: '0.08em', cursor: 'pointer',
        padding: '2px 7px', borderRadius: '2px', flexShrink: 0,
        color: colour, border: `1px solid ${colour}55`, background: `${colour}12`,
      }}
    >
      L{level} {capability.levelName}
    </span>
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
function VoiceHUD({ transcript, wakeActive, recording, error }) {
  if (!transcript && !wakeActive && !recording && !error) return null;

  const colour = error ? 'var(--red)' : recording ? 'var(--red)' : 'var(--magenta)';
  const label  = error     ? error
               : recording ? '● Listening — release to transcribe'
               : wakeActive ? '🎙 Rāma is listening...'
               : transcript;

  return (
    <div style={{
      position:   'fixed',
      bottom:     '24px',
      left:       '50%',
      transform:  'translateX(-50%)',
      background: `color-mix(in srgb, ${colour} 15%, transparent)`,
      border:     `1px solid ${colour}`,
      borderRadius:'var(--radius-lg)',
      padding:    '8px 20px',
      color:      colour,
      fontSize:   '12px',
      maxWidth:   '70vw',
      zIndex:     9000,
      backdropFilter: 'blur(8px)',
      boxShadow:  `0 0 12px ${colour}55`,
      display:    'flex',
      alignItems: 'center',
      gap:        '10px',
      animation:  'fadeIn 0.2s ease',
    }}>
      <div style={{
        width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0,
        background: colour,
        animation: (recording || wakeActive) ? 'pulse-ring 1s ease infinite' : 'none',
        boxShadow: `0 0 8px ${colour}`,
      }} />
      {label}
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
    micMode, setMicMode, micMuted, setMicMuted, toggleMicMuted,
    speechMuted, setSpeechMuted, toggleSpeechMuted,
    pendingModification, clearPendingMod,
    masterAuthenticated,
  } = useUIStore();

  const { addMessage, activeSessionId, createSession } = useRamaStore();

  const inputRef      = useRef(null);
  const voiceRef      = useRef(null);
  const [voiceTranscript, setVoiceTranscript] = useState('');
  const [wakeActive,      setWakeActive]      = useState(false);
  const [voiceCap,        setVoiceCap]        = useState(null);
  const [recording,       setRecording]       = useState(false);
  const [voiceError,      setVoiceError]      = useState('');
  const [modeMenuOpen,    setModeMenuOpen]    = useState(false);

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
    // The tab strip stays open: it is the app's only navigation, so collapsing it
    // on every click meant one move and then no visible way back.
    setPaletteQuery('');
    setWakeActive(false);
  }, [navigate, pushRecent, setPaletteQuery, allPages]);

  // ── Voice engine setup ───────────────────────────────────────────────────
  // The engine resolves its own capability ladder and only starts continuous
  // listening if this machine can actually do it. It no longer auto-starts a
  // recogniser that cannot work — that was a permanent failure loop in Electron.
  useEffect(() => {
    const engine = new VoiceEngine({
      onWake: () => {
        setWakeActive(true);
        openPalette();
        setTimeout(() => setWakeActive(false), 8000);
      },
      onTranscript: (t, isFinal) => {
        setVoiceTranscript(t);
        if (isFinal) setTimeout(() => setVoiceTranscript(''), 2500);
      },
      onCommand: (matched, command) => {
        setLastVoiceCmd(command);
        setWakeActive(false);
        if (matched.route) {
          goTo(matched.route);
        } else if (matched.action === 'close-palette') {
          closePalette();
        } else if (matched.action === 'open-palette') {
          openPalette();
        } else if (matched.action === 'mute-speech') {
          setSpeechMuted(true);
          engine.setSpeechMuted(true);
        } else if (matched.action === 'unmute-speech') {
          setSpeechMuted(false);
          engine.setSpeechMuted(false);
        } else if (matched.action === 'mute-mic') {
          setMicMuted(true);
          engine.setMicMuted(true);
        } else if (matched.action === 'badge-enable') {
          window.rama?.badge?.setEnabled(true);
        } else if (matched.action === 'badge-disable') {
          window.rama?.badge?.setEnabled(false);
        } else if (matched.action === 'bring-to-front') {
          window.rama?.badge?.bringToFront();
        } else if (matched.action === 'inject-message') {
          if (!activeSessionId) createSession();
          addMessage({ role: 'user', content: matched.message, id: Date.now() });
          navigate('/');
          closePalette();
        }
      },
      onError:  (err) => { setVoiceError(String(err)); setTimeout(() => setVoiceError(''), 6000); },
      onLevel:  (cap) => setVoiceCap(cap),
      onState:  (st)  => { setRecording(st.recording); setVoiceActive(st.listening || st.recording); },
      onReady:  async (cap) => {
        setVoiceCap(cap);
        setVoiceWakeReady(!!cap?.wakeWordCapable);

        // Restore the saved preferences. A saved mode this machine can no longer
        // deliver falls back to the best it can, rather than silently doing nothing.
        engine.setSpeechMuted(speechMuted);
        engine.setMicMuted(micMuted);

        const available = modesForLevel(cap);
        const wanted    = available.includes(micMode) ? micMode
                        : available.includes(MIC_MODES.PTT) ? MIC_MODES.PTT
                        : MIC_MODES.OFF;
        if (wanted !== micMode) setMicMode(wanted);
        await engine.setMode(wanted);
      },
    });

    voiceRef.current = engine;
    engine.init();

    return () => engine.stop();
  }, []);  // eslint-disable-line

  // ── Mute controls ─────────────────────────────────────────────────────────
  const handleToggleMic = useCallback(() => {
    const next = toggleMicMuted();
    voiceRef.current?.setMicMuted(next);
    setVoiceError(next ? 'Mic muted' : 'Mic live');
    setTimeout(() => setVoiceError(''), 1800);
  }, [toggleMicMuted]);

  const handleToggleSpeech = useCallback(() => {
    const next = toggleSpeechMuted();
    voiceRef.current?.setSpeechMuted(next);
    setVoiceError(next ? 'Rāma will stay silent' : 'Rāma can speak');
    setTimeout(() => setVoiceError(''), 1800);
  }, [toggleSpeechMuted]);

  const handlePickMode = useCallback(async (mode) => {
    setModeMenuOpen(false);
    const engine = voiceRef.current;
    if (!engine) return;
    if (await engine.setMode(mode)) {
      setMicMode(mode);
      // Choosing a listening mode implies wanting to be heard
      if (mode !== MIC_MODES.OFF && micMuted) {
        setMicMuted(false);
        engine.setMicMuted(false);
      }
    }
  }, [setMicMode, micMuted, setMicMuted]);

  // ── Keyboard: Ctrl+Shift+M mic, Ctrl+Shift+S speech ──────────────────────
  useEffect(() => {
    const handler = (e) => {
      if (!(e.ctrlKey || e.metaKey) || !e.shiftKey) return;
      const key = e.key.toLowerCase();
      if (key === 'm') { e.preventDefault(); handleToggleMic(); }
      if (key === 's') { e.preventDefault(); handleToggleSpeech(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleToggleMic, handleToggleSpeech]);

  // Push-to-talk: hold to capture, release to transcribe
  const startTalk = useCallback(async () => {
    const engine = voiceRef.current;
    if (!engine) return;
    const started = await engine.startRecording();
    if (started) setRecording(true);
  }, []);

  const endTalk = useCallback(async () => {
    const engine = voiceRef.current;
    if (!engine || !engine.recording) { setRecording(false); return; }
    setRecording(false);
    setVoiceTranscript('Transcribing...');
    await engine.stopRecordingAndTranscribe();
  }, []);

  const rescanVoice = useCallback(async () => {
    const engine = voiceRef.current;
    if (!engine) return;
    setVoiceCap(await engine.rescan());
  }, []);

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
      <VoiceHUD
        transcript={voiceTranscript}
        wakeActive={wakeActive}
        recording={recording}
        error={voiceError}
      />

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
          <VoiceLevelChip capability={voiceCap} onRescan={rescanVoice} />
          <SpeechMuteBtn muted={speechMuted} onToggle={handleToggleSpeech} />
          <VoiceMicBtn
            capability={voiceCap}
            recording={recording}
            micMuted={micMuted}
            mode={micMode}
            onToggleMute={handleToggleMic}
            onPressStart={startTalk}
            onPressEnd={endTalk}
            onOpenModes={() => setModeMenuOpen(o => !o)}
          />
          <MicModeMenu
            open={modeMenuOpen}
            capability={voiceCap}
            mode={micMode}
            onPick={handlePickMode}
            onClose={() => setModeMenuOpen(false)}
          />
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

      {/* Navigation handle — a real, labelled target. This used to be a 3px
          strip, which is not a hit area anyone finds, and it is the only way to
          reach navigation once collapsed. */}
      <div
        onClick={() => (paletteOpen ? closePalette() : openPalette())}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            paletteOpen ? closePalette() : openPalette();
          }
        }}
        title={paletteOpen ? 'Hide navigation' : 'Show navigation (Ctrl+K)'}
        style={{
          height:         paletteOpen ? '4px' : '22px',
          display:        'flex',
          alignItems:     'center',
          justifyContent: 'center',
          gap:            '8px',
          background:     paletteOpen
            ? 'linear-gradient(90deg, var(--violet), var(--accent), var(--magenta))'
            : 'var(--surface)',
          borderBottom:   paletteOpen ? 'none' : '1px solid var(--border)',
          cursor:         'pointer',
          transition:     'height 0.2s, background 0.3s',
          flexShrink:     0,
          boxShadow:      paletteOpen ? '0 0 8px rgba(0,200,255,0.4)' : 'none',
          fontSize:       '9px',
          letterSpacing:  '0.14em',
          color:          'var(--muted)',
          userSelect:     'none',
        }}
      >
        {!paletteOpen && (
          <>
            <span style={{ color: 'var(--accent)' }}>▾</span>
            <span>NAVIGATION</span>
            <span style={{ opacity: 0.6 }}>Ctrl+K</span>
          </>
        )}
      </div>
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
