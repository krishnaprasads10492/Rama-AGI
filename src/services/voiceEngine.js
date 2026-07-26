/**
 * voiceEngine.js — Rāma's voice capability, built as a progressive ladder.
 *
 * THE RULE (spec section 30): start at the level that needs nothing, work there,
 * and climb only when a resource is actually present. Never silently do nothing.
 *
 *   L0 TEXT          nothing               Ctrl+K palette — always works
 *   L1 PUSH-TO-TALK  mic permission        hold to speak, release to transcribe
 *   L2 LOCAL STT     Whisper binary        private, offline, free
 *   L3 CLOUD STT     OpenAI key in vault   highest accuracy
 *   L4 WAKE WORD     continuous local STT  "Hey Rāma" hands-free
 *
 * WHY THIS WAS REWRITTEN: the old engine relied on `webkitSpeechRecognition` and
 * auto-started continuous listening at app load. That API cannot work in the
 * Electron shell — Chromium ships without the Google API keys Chrome has, so it
 * fails with `network` every time. The engine then restarted 300ms after each
 * failure, so it sat in a permanent error loop and never transcribed anything.
 *
 * Web Speech is still used opportunistically (it works in a plain browser), but
 * it is probed once and permanently disabled on the first `network` error instead
 * of retried forever.
 */

import { matchVoiceToRoute } from '@config/registry.js';

const WAKE_WORDS = ['hey rama', 'hey rāma', 'hey roma', 'hey lama'];

// Non-navigation UI actions. Navigation phrases live on each PageDef.
const VOICE_ACTIONS = [
  { patterns: ['close palette', 'close menu', 'dismiss', 'cancel'],    action: 'close-palette' },
  { patterns: ['open menu', 'open palette', 'show commands'],          action: 'open-palette'  },
  { patterns: ['identify yourself', 'who are you', 'reveal identity'], action: 'identify'      },
];

export const VOICE_LEVELS = {
  TEXT:         0,
  PUSH_TO_TALK: 1,
  LOCAL_STT:    2,
  CLOUD_STT:    3,
  WAKE_WORD:    4,
};

export const LEVEL_NAMES = ['TEXT', 'PUSH-TO-TALK', 'LOCAL STT', 'CLOUD STT', 'WAKE WORD'];

const ipc = () => (typeof window !== 'undefined' ? window.rama?.voice : null);

// ─── Capability resolution ────────────────────────────────────────────────────
/**
 * What can voice actually do on this machine right now?
 * Measured, never assumed — and the answer always includes what the next level
 * would require, so the UI can tell the user how to climb.
 */
export async function resolveVoiceCapability() {
  const base = {
    level:     VOICE_LEVELS.TEXT,
    levelName: 'TEXT',
    canRecord: false,
    canTranscribe: false,
    wakeWordCapable: false,
    webSpeech: false,
    backend:   null,
    nextStep:  null,
    reason:    null,
  };

  // L1 — can we capture audio at all?
  const canRecord =
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof window !== 'undefined' &&
    typeof window.MediaRecorder !== 'undefined';

  // Web Speech: present in a plain browser, broken in the Electron shell.
  // Treat mere presence as a candidate, not as a capability.
  const webSpeechPresent =
    typeof window !== 'undefined' &&
    ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);

  const inElectron = typeof window !== 'undefined' && !!window.rama;

  // In the desktop shell, transcription comes from the main process ladder
  if (inElectron && ipc()) {
    const res = await ipc().capabilities().catch(() => null);
    const d   = res?.ok ? res.data : null;

    if (!d) {
      return { ...base, canRecord, webSpeech: false,
               reason: 'Voice backend did not answer', nextStep: 'Restart Rāma' };
    }

    let level = VOICE_LEVELS.TEXT;
    if (canRecord && d.canTranscribe) {
      level = d.backend === 'local' ? VOICE_LEVELS.LOCAL_STT : VOICE_LEVELS.CLOUD_STT;
      if (d.wakeWordCapable) level = VOICE_LEVELS.WAKE_WORD;
    } else if (canRecord) {
      level = VOICE_LEVELS.PUSH_TO_TALK;
    }

    return {
      ...base,
      level,
      levelName: LEVEL_NAMES[level],
      canRecord,
      canTranscribe: !!d.canTranscribe,
      wakeWordCapable: !!d.wakeWordCapable,
      webSpeech: false,             // never viable in the shell
      backend:   d.backend,
      nextStep:  canRecord ? d.nextStep : 'Grant microphone permission',
      reason:    d.canTranscribe ? null : (d.local?.reason ?? d.cloud?.reason ?? null),
      detail:    d,
    };
  }

  // Browser mode: Web Speech may genuinely work, which is the only path to L4 here
  if (webSpeechPresent && canRecord) {
    return {
      ...base,
      level: VOICE_LEVELS.WAKE_WORD,
      levelName: LEVEL_NAMES[VOICE_LEVELS.WAKE_WORD],
      canRecord: true, canTranscribe: true, wakeWordCapable: true,
      webSpeech: true, backend: 'web-speech',
    };
  }

  return {
    ...base,
    canRecord,
    reason:   'No transcription backend in this environment',
    nextStep: 'Use the desktop app, or Ctrl+K for typed commands',
  };
}

// ─── VoiceEngine ──────────────────────────────────────────────────────────────
export class VoiceEngine {
  constructor({ onCommand, onWake, onTranscript, onError, onReady, onLevel } = {}) {
    this.onCommand    = onCommand;
    this.onWake       = onWake;
    this.onTranscript = onTranscript;
    this.onError      = onError;
    this.onReady      = onReady;
    this.onLevel      = onLevel;

    this.capability   = null;
    this.recognition  = null;
    this.listening    = false;
    this.recording    = false;
    this.wakeDetected = false;
    this.wakeTimer    = null;

    this._recorder    = null;
    this._chunks      = [];
    this._stream      = null;
    // Once Web Speech fails with `network` it will never succeed in this
    // environment. Latch it off rather than retrying forever.
    this._webSpeechDead = false;
    this._shouldRestart = false;
  }

  /** Resolve the ladder. Safe to call repeatedly. */
  async init() {
    this.capability = await resolveVoiceCapability();
    this.onLevel?.(this.capability);

    if (this.capability.webSpeech && !this._webSpeechDead) {
      this._initWebSpeech();
    }

    this.onReady?.(this.capability);
    return this.capability;
  }

  get level()     { return this.capability?.level ?? VOICE_LEVELS.TEXT; }
  get levelName() { return this.capability?.levelName ?? 'TEXT'; }

  /** Can this environment listen continuously for a wake word? */
  get canWake() {
    return !!this.capability?.wakeWordCapable && !this._webSpeechDead;
  }

  // ── Web Speech (browser only, opportunistic) ────────────────────────────────
  _initWebSpeech() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return false;

    const rec = new SR();
    rec.continuous       = true;
    rec.interimResults   = true;
    rec.lang             = 'en-US';
    rec.maxAlternatives  = 3;

    rec.onstart = () => { this.listening = true; };

    rec.onresult = (event) => {
      for (const result of Array.from(event.results)) {
        const transcript = Array.from(result)
          .map(r => r.transcript).join(' ').toLowerCase().trim();

        this.onTranscript?.(transcript, result.isFinal);

        if (result.isFinal) this._process(transcript);
        else if (!this.wakeDetected && this._hasWake(transcript)) this._onWake(transcript);
      }
    };

    rec.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;

      // The decisive case: Chromium without Google's API keys. Retrying cannot
      // help, so stop permanently and drop the reported level.
      if (e.error === 'network' || e.error === 'service-not-allowed') {
        this._webSpeechDead = true;
        this._shouldRestart = false;
        this.listening      = false;
        try { rec.abort(); } catch { /* already stopped */ }

        this.capability = {
          ...this.capability,
          webSpeech: false,
          wakeWordCapable: false,
          level: this.capability?.canRecord ? VOICE_LEVELS.PUSH_TO_TALK : VOICE_LEVELS.TEXT,
          levelName: LEVEL_NAMES[this.capability?.canRecord ? VOICE_LEVELS.PUSH_TO_TALK : VOICE_LEVELS.TEXT],
          reason: 'Browser speech recognition is unavailable in this build',
          nextStep: 'Install a local Whisper binary, or add an OpenAI key for cloud transcription',
        };
        this.onLevel?.(this.capability);
        this.onError?.('Browser speech recognition unavailable — falling back to push-to-talk');
        return;
      }

      this.onError?.(e.error);
    };

    rec.onend = () => {
      this.listening = false;
      // Only restart when the engine is actually viable
      if (this._shouldRestart && !this._webSpeechDead) {
        setTimeout(() => this.start(), 400);
      }
    };

    this.recognition = rec;
    return true;
  }

  /** Begin passive wake-word listening, if this environment supports it. */
  start() {
    if (!this.canWake || !this.recognition) return false;
    if (this.listening) return true;
    this._shouldRestart = true;
    try { this.recognition.start(); return true; }
    catch { return false; }   // already started
  }

  stop() {
    this._shouldRestart = false;
    this.listening      = false;
    this.wakeDetected   = false;
    clearTimeout(this.wakeTimer);
    try { this.recognition?.abort(); } catch { /* ignore */ }
    this._stopRecording();
  }

  // ── Push-to-talk (levels 1–3) ───────────────────────────────────────────────
  /**
   * Start capturing. Returns false with a reason on the callback rather than
   * throwing, so the UI can explain what is missing.
   */
  async startRecording() {
    if (this.recording) return true;
    if (!this.capability?.canRecord) {
      this.onError?.(this.capability?.nextStep ?? 'Microphone unavailable');
      return false;
    }

    try {
      this._stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
      });
    } catch (err) {
      this.onError?.(
        err.name === 'NotAllowedError'
          ? 'Microphone permission denied'
          : `Microphone unavailable: ${err.message}`
      );
      return false;
    }

    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']
      .find(t => window.MediaRecorder.isTypeSupported?.(t)) || '';

    this._chunks   = [];
    this._recorder = new window.MediaRecorder(this._stream, mime ? { mimeType: mime } : undefined);
    this._recorder.ondataavailable = (e) => { if (e.data?.size) this._chunks.push(e.data); };
    this._recorder.start(250);
    this.recording = true;
    return true;
  }

  /**
   * Stop capturing and transcribe. Resolves the recognised text, or null with the
   * reason reported through onError.
   */
  async stopRecordingAndTranscribe() {
    if (!this.recording || !this._recorder) return null;

    const blob = await new Promise((resolve) => {
      this._recorder.onstop = () => resolve(new Blob(this._chunks, { type: this._recorder.mimeType || 'audio/webm' }));
      try { this._recorder.stop(); } catch { resolve(null); }
    });

    this._stopRecording();

    if (!blob || blob.size < 1200) {
      this.onError?.('Clip too short — hold the button while speaking');
      return null;
    }

    const api = ipc();
    if (!api) {
      this.onError?.('Transcription needs the desktop app');
      return null;
    }

    const base64 = await blobToBase64(blob);
    const res = await api.transcribe({ data: base64, mimeType: blob.type, language: 'en' });

    if (!res?.ok) {
      this.onError?.(res?.hint ? `${res.error} — ${res.hint}` : (res?.error ?? 'Transcription failed'));
      // Re-resolve: the reason may be a level change worth showing
      this.capability = await resolveVoiceCapability();
      this.onLevel?.(this.capability);
      return null;
    }

    this.onTranscript?.(res.text, true);
    this._process(res.text, { requireWake: false });
    return res.text;
  }

  _stopRecording() {
    this.recording = false;
    try { this._stream?.getTracks().forEach(t => t.stop()); } catch { /* ignore */ }
    this._stream   = null;
    this._recorder = null;
    this._chunks   = [];
  }

  /** Re-probe the backends — call after the user installs Whisper or adds a key. */
  async rescan() {
    const api = ipc();
    if (api) await api.rescan().catch(() => null);
    return this.init();
  }

  // ── Speech synthesis (independent of recognition, always available) ─────────
  speak(text, opts = {}) {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return false;
    window.speechSynthesis.cancel();

    const utter  = new SpeechSynthesisUtterance(text);
    utter.rate   = opts.rate   ?? 0.95;
    utter.pitch  = opts.pitch  ?? 1.0;
    utter.volume = opts.volume ?? 0.9;
    utter.lang   = 'en-US';

    const voices = window.speechSynthesis.getVoices();
    const preferred = voices.find(v => v.name.includes('Google UK English Male'))
                   || voices.find(v => v.name.includes('Daniel'))
                   || voices.find(v => !v.name.includes('Female') && v.lang.startsWith('en'));
    if (preferred) utter.voice = preferred;

    window.speechSynthesis.speak(utter);
    return true;
  }

  // ── Internals ───────────────────────────────────────────────────────────────
  _hasWake(t) { return WAKE_WORDS.some(w => t.includes(w)); }

  _onWake(transcript) {
    this.wakeDetected = true;
    this.onWake?.(transcript);
    clearTimeout(this.wakeTimer);
    this.wakeTimer = setTimeout(() => { this.wakeDetected = false; }, 8000);
  }

  /**
   * @param {string} transcript
   * @param {object} opts requireWake — false for push-to-talk, where pressing the
   *        button is itself the intent signal and no wake word is needed.
   */
  _process(transcript, { requireWake = true } = {}) {
    const lower = String(transcript || '').toLowerCase().trim();
    if (!lower) return;

    const hasWake = this._hasWake(lower);
    if (hasWake) this._onWake(lower);

    if (requireWake && !this.wakeDetected && !hasWake) return;

    let command = lower;
    for (const w of WAKE_WORDS) command = command.replace(w, '').trim();
    if (!command) return;

    this.wakeDetected = false;
    clearTimeout(this.wakeTimer);

    const matched = matchVoiceCommand(command);
    this.onCommand?.(
      matched ?? { route: '/', action: 'inject-message', message: command },
      command,
      transcript
    );
  }
}

// ─── Command matching ─────────────────────────────────────────────────────────
export function matchVoiceCommand(command) {
  const lower = String(command || '').toLowerCase();

  // UI actions win over navigation — "cancel" must never open a page
  for (const entry of VOICE_ACTIONS) {
    if (entry.patterns.some(p => lower.includes(p))) {
      return { route: null, action: entry.action };
    }
  }

  // Navigation, resolved from the page registry
  const nav = matchVoiceToRoute(lower);
  if (nav) return { route: nav.route, action: null, page: nav.page };

  const search = lower.match(/(?:search for|look up|find|research)\s+(.+)/);
  if (search) return { route: '/', action: 'inject-message', message: `Search: ${search[1]}` };

  const agent = lower.match(/spawn\s+(?:a\s+)?(\w+)\s+agent/);
  if (agent) return { route: '/agents', action: 'spawn-agent', agentType: agent[1] };

  return null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror   = () => reject(new Error('Could not read the audio clip'));
    reader.readAsDataURL(blob);
  });
}

export { VOICE_ACTIONS, WAKE_WORDS };
