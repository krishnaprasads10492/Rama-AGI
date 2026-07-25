/**
 * voiceEngine.js — Web Speech API voice command engine.
 * Wake word: "Hey Rāma" (or "Hey Rama" — accent-insensitive).
 * Routes spoken commands to navigation, agents, and AI chat.
 */

const WAKE_WORDS = ['hey rama', 'hey rāma', 'hey roma', 'hey lama'];  // fuzzy matches

// Navigation phrases live on each PageDef in src/config/registry.js.
// Only non-navigation UI actions are declared here.
import { matchVoiceToRoute } from '@config/registry.js';

const VOICE_ACTIONS = [
  { patterns: ['close palette', 'close menu', 'dismiss', 'cancel'],    action: 'close-palette' },
  { patterns: ['open menu', 'open palette', 'show commands'],          action: 'open-palette'  },
  { patterns: ['identify yourself', 'who are you', 'reveal identity'], action: 'identify'      },
];

// ─── VoiceEngine class ────────────────────────────────────────────────────────
export class VoiceEngine {
  constructor({ onCommand, onWake, onTranscript, onError, onReady }) {
    this.onCommand    = onCommand;
    this.onWake       = onWake;
    this.onTranscript = onTranscript;
    this.onError      = onError;
    this.onReady      = onReady;

    this.recognition  = null;
    this.listening    = false;
    this.wakeDetected = false;
    this.wakeTimer    = null;
    this.supported    = 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;
  }

  init() {
    if (!this.supported) {
      this.onError?.('Web Speech API not supported in this browser/Electron version');
      return false;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.recognition = new SpeechRecognition();
    this.recognition.continuous    = true;
    this.recognition.interimResults = true;
    this.recognition.lang          = 'en-US';
    this.recognition.maxAlternatives = 3;

    this.recognition.onstart = () => {
      this.listening = true;
      this.onReady?.();
    };

    this.recognition.onresult = (event) => {
      const results = Array.from(event.results);
      for (const result of results) {
        const transcript = Array.from(result)
          .map(r => r.transcript)
          .join(' ')
          .toLowerCase()
          .trim();

        this.onTranscript?.(transcript, result.isFinal);

        if (result.isFinal) {
          this._processTranscript(transcript);
        } else {
          // Detect wake word in interim results for fast response
          if (!this.wakeDetected && this._containsWakeWord(transcript)) {
            this._onWakeDetected(transcript);
          }
        }
      }
    };

    this.recognition.onerror = (e) => {
      if (e.error === 'no-speech') return;   // Expected — just no speech detected
      if (e.error === 'aborted')  return;   // We aborted intentionally
      this.onError?.(e.error);
    };

    this.recognition.onend = () => {
      this.listening = false;
      // Auto-restart for continuous listening
      if (this._shouldRestart) {
        setTimeout(() => this.start(), 300);
      }
    };

    return true;
  }

  start() {
    if (!this.recognition) this.init();
    if (this.listening) return;
    this._shouldRestart = true;
    try {
      this.recognition.start();
    } catch { /* already started */ }
  }

  stop() {
    this._shouldRestart = false;
    this.listening      = false;
    this.wakeDetected   = false;
    clearTimeout(this.wakeTimer);
    try { this.recognition?.abort(); } catch { /* ignore */ }
  }

  // ── Speak a response (TTS) ─────────────────────────────────────────────────
  speak(text, opts = {}) {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();   // stop any current speech

    const utter          = new SpeechSynthesisUtterance(text);
    utter.rate           = opts.rate   || 0.95;
    utter.pitch          = opts.pitch  || 1.0;
    utter.volume         = opts.volume || 0.9;
    utter.lang           = 'en-US';

    // Prefer a deeper, more neutral voice
    const voices = window.speechSynthesis.getVoices();
    const preferred = voices.find(v => v.name.includes('Google UK English Male'))
                   || voices.find(v => v.name.includes('Daniel'))
                   || voices.find(v => !v.name.includes('Female') && v.lang.startsWith('en'));
    if (preferred) utter.voice = preferred;

    window.speechSynthesis.speak(utter);
  }

  // ── Internal ───────────────────────────────────────────────────────────────
  _containsWakeWord(transcript) {
    return WAKE_WORDS.some(w => transcript.includes(w));
  }

  _onWakeDetected(transcript) {
    this.wakeDetected = true;
    this.onWake?.(transcript);
    // Reset wake state after 8 seconds (command window)
    clearTimeout(this.wakeTimer);
    this.wakeTimer = setTimeout(() => {
      this.wakeDetected = false;
    }, 8000);
  }

  _processTranscript(transcript) {
    const lower = transcript.toLowerCase();

    // Check for wake word
    const hasWake = this._containsWakeWord(lower);
    if (hasWake) {
      this._onWakeDetected(transcript);
    }

    // Only process commands after wake
    if (!this.wakeDetected && !hasWake) return;

    // Strip wake word from transcript to get command
    let command = lower;
    for (const wake of WAKE_WORDS) {
      command = command.replace(wake, '').trim();
    }

    if (!command) return;

    // Match route/action
    const matched = matchVoiceCommand(command);
    if (matched) {
      this.wakeDetected = false;
      clearTimeout(this.wakeTimer);
      this.onCommand?.(matched, command, transcript);
    } else {
      // Unknown command → route to AI chat
      this.onCommand?.({ route: '/', action: 'inject-message', message: command }, command, transcript);
    }
  }
}

// ─── Match a spoken command to a route/action ─────────────────────────────────
export function matchVoiceCommand(command) {
  const lower = command.toLowerCase();

  // UI actions win over navigation ("cancel" should never open a page)
  for (const entry of VOICE_ACTIONS) {
    if (entry.patterns.some(p => lower.includes(p))) {
      return { route: null, action: entry.action };
    }
  }

  // Navigation — resolved from the page registry
  const nav = matchVoiceToRoute(lower);
  if (nav) return { route: nav.route, action: null, page: nav.page };

  // "search for X" or "look up X"
  const searchMatch = lower.match(/(?:search for|look up|find|research)\s+(.+)/);
  if (searchMatch) {
    return { route: '/', action: 'inject-message', message: `Search: ${searchMatch[1]}` };
  }

  // "spawn a [type] agent" 
  const agentMatch = lower.match(/spawn\s+(?:a\s+)?(\w+)\s+agent/);
  if (agentMatch) {
    return { route: '/agents', action: 'spawn-agent', agentType: agentMatch[1] };
  }

  return null;
}

export { VOICE_ACTIONS };
