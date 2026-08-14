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

// "hey buddy" is a casual nickname alias master asked for — treated as a
// second wake phrase, not a separate command, since a bare "buddy" address
// has no discrete action of its own (and a bare word, unlike a full phrase,
// would false-trigger on ordinary sentences that happen to contain it).
const WAKE_WORDS = ['hey rama', 'hey rāma', 'hey roma', 'hey lama', 'hey buddy'];

// Non-navigation UI actions. Navigation phrases live on each PageDef.
const VOICE_ACTIONS = [
  { patterns: ['close palette', 'close menu', 'dismiss', 'cancel'],    action: 'close-palette' },
  { patterns: ['open menu', 'open palette', 'show commands'],          action: 'open-palette'  },
  { patterns: ['identify yourself', 'who are you', 'reveal identity'], action: 'identify'      },
  // Speech mute: Rāma stops talking but keeps listening. Casual synonyms
  // ("shut up", "no convo") sit alongside the formal phrasing rather than
  // as a separate action, since they mean the same thing.
  { patterns: ['stop talking', 'be quiet', 'silence', 'mute yourself', 'shut up', 'no convo', 'stop the conversation'],
    action: 'mute-speech' },
  { patterns: ['you can talk', 'speak again', 'unmute yourself', 'convo yes', 'lets talk', "let's talk"],
    action: 'unmute-speech' },
  // Mic mute. Unmuting by voice is impossible once muted — the device is
  // released and nothing is listening — so only muting is offered here.
  { patterns: ['mute the mic', 'mute microphone', 'stop listening'],    action: 'mute-mic'      },

  // ── Status badge (spec: always-on-top presence indicator) ────────────────
  // Enable = clickable, opens the full app on click. Disable = click-through,
  // dims to the "closed" ring — it stays visible the whole time, this only
  // changes whether it can be interacted with. Generous synonyms per
  // master's explicit request that plain "enable"/"disable" and casual
  // phrasing both work.
  { patterns: ['enable badge', 'enable the badge', 'turn on the badge', 'badge on', 'show the badge', 'wake up the badge'],
    action: 'badge-enable' },
  { patterns: ['disable badge', 'disable the badge', 'turn off the badge', 'badge off', 'hide the badge'],
    action: 'badge-disable' },

  // Bring the whole app forward regardless of current visibility — the
  // "still voice listener only could be on, then bring back entire thing
  // live" behaviour. Works whether the window is hidden, minimized to the
  // badge, or the tray icon itself is hidden.
  { patterns: ['come back', 'come to front', 'show yourself', "i'm here", 'im here', 'bring rama forward', 'wake up rama'],
    action: 'bring-to-front' },
];

export const VOICE_LEVELS = {
  TEXT:         0,
  PUSH_TO_TALK: 1,
  LOCAL_STT:    2,
  CLOUD_STT:    3,
  WAKE_WORD:    4,
};

export const LEVEL_NAMES = ['TEXT', 'PUSH-TO-TALK', 'LOCAL STT', 'CLOUD STT', 'WAKE WORD'];

/** Mic modes. See spec section 31. */
export const MIC_MODES = {
  OFF:        'off',
  PTT:        'ptt',
  HANDS_FREE: 'hands-free',
  WAKE:       'wake',
};

export const MIC_MODE_LABELS = {
  [MIC_MODES.OFF]:        'Off',
  [MIC_MODES.PTT]:        'Hold to talk',
  [MIC_MODES.HANDS_FREE]: 'Hands-free',
  [MIC_MODES.WAKE]:       'Wake word',
};

/** Which modes this capability level can actually deliver. */
export function modesForLevel(capability) {
  const modes = [MIC_MODES.OFF];
  if (!capability) return modes;
  if (capability.canRecord) modes.push(MIC_MODES.PTT);
  if (capability.canRecord && capability.canTranscribe) modes.push(MIC_MODES.HANDS_FREE);
  if (capability.wakeWordCapable) modes.push(MIC_MODES.WAKE);
  return modes;
}

// ─── Hands-free segmentation tuning (spec section 31) ─────────────────────────
const VAD = {
  SPEECH_RMS:      0.018,   // above this counts as speech
  SILENCE_MS:      1200,    // silence that closes a segment
  MIN_SEGMENT_MS:  400,     // shorter than this is noise, discarded
  MAX_SEGMENT_MS:  30_000,  // hard ceiling so noise cannot run unbounded
  COOLDOWN_MS:     250,     // stops Rāma's own TTS echo re-triggering capture
  POLL_MS:         80,
};

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
  constructor({ onCommand, onWake, onTranscript, onError, onReady, onLevel, onState } = {}) {
    this.onCommand    = onCommand;
    this.onWake       = onWake;
    this.onTranscript = onTranscript;
    this.onError      = onError;
    this.onReady      = onReady;
    this.onLevel      = onLevel;
    this.onState      = onState;   // { mode, micMuted, speechMuted, recording, listening }

    this.capability   = null;
    this.recognition  = null;
    this.listening    = false;
    this.recording    = false;
    this.wakeDetected = false;
    this.wakeTimer    = null;

    // Mic mode and the two independent mutes
    this.mode        = MIC_MODES.PTT;
    this.micMuted    = false;
    this.speechMuted = false;

    this._recorder    = null;
    this._chunks      = [];
    this._stream      = null;

    // Hands-free segmentation
    this._audioCtx    = null;
    this._analyser    = null;
    this._vadTimer    = null;
    this._segmentOpen = false;
    this._silenceSince = 0;
    this._segmentStart = 0;
    this._cooldownUntil = 0;

    // Once Web Speech fails with `network` it will never succeed in this
    // environment. Latch it off rather than retrying forever.
    this._webSpeechDead = false;
    this._shouldRestart = false;
  }

  _emitState() {
    this.onState?.({
      mode:        this.mode,
      micMuted:    this.micMuted,
      speechMuted: this.speechMuted,
      recording:   this.recording,
      listening:   this.listening,
      handsFree:   this.mode === MIC_MODES.HANDS_FREE && !this.micMuted,
    });
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

  /** Modes this machine can actually deliver right now. */
  get availableModes() { return modesForLevel(this.capability); }

  // ── Mute (spec section 31) ──────────────────────────────────────────────────
  /**
   * Mute the microphone. This releases the OS device rather than ignoring input,
   * so the platform's mic-in-use indicator goes out — a mute that leaves the
   * light on is not one the user can trust.
   */
  setMicMuted(muted) {
    this.micMuted = !!muted;

    if (this.micMuted) {
      this._stopHandsFree();
      this._shouldRestart = false;
      try { this.recognition?.abort(); } catch { /* already stopped */ }
      this.listening = false;
      this._stopRecording();          // releases the stream and its tracks
    } else {
      this._applyMode();
    }

    this._emitState();
    return this.micMuted;
  }

  toggleMicMuted() { return this.setMicMuted(!this.micMuted); }

  /** Mute Rāma's speech. Cancels anything mid-utterance. */
  setSpeechMuted(muted) {
    this.speechMuted = !!muted;
    if (this.speechMuted && typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    this._emitState();
    return this.speechMuted;
  }

  toggleSpeechMuted() { return this.setSpeechMuted(!this.speechMuted); }

  // ── Mode ────────────────────────────────────────────────────────────────────
  /**
   * Set the mic mode. A mode this machine cannot deliver is refused rather than
   * accepted and silently ignored — the reason goes to onError.
   */
  async setMode(mode) {
    if (!this.availableModes.includes(mode)) {
      this.onError?.(
        `${MIC_MODE_LABELS[mode] ?? mode} needs ${
          mode === MIC_MODES.WAKE ? 'a local speech engine' : 'a transcription backend'
        }${this.capability?.nextStep ? ` — ${this.capability.nextStep}` : ''}`
      );
      return false;
    }

    this.mode = mode;
    await this._applyMode();
    this._emitState();
    return true;
  }

  /** Start or stop the continuous machinery to match the current mode. */
  async _applyMode() {
    this._stopHandsFree();
    this._shouldRestart = false;
    try { this.recognition?.abort(); } catch { /* ignore */ }
    this.listening = false;

    if (this.micMuted) return;

    if (this.mode === MIC_MODES.WAKE)       this.start();
    else if (this.mode === MIC_MODES.HANDS_FREE) await this._startHandsFree();
  }

  // ── Hands-free: open mic with silence-based segmentation ────────────────────
  /**
   * The answer to "unmute and just talk" on machines with no wake word. An
   * AnalyserNode measures RMS; a segment opens on speech and closes after
   * VAD.SILENCE_MS of quiet, then goes to the transcription ladder.
   */
  async _startHandsFree() {
    if (!this.capability?.canRecord || !this.capability?.canTranscribe) {
      this.onError?.(this.capability?.nextStep ?? 'Hands-free needs a transcription backend');
      return false;
    }

    const stream = await this._openStream();
    if (!stream) return false;

    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      this._audioCtx = new Ctx();
      const source   = this._audioCtx.createMediaStreamSource(stream);
      this._analyser = this._audioCtx.createAnalyser();
      this._analyser.fftSize = 1024;
      source.connect(this._analyser);
    } catch (err) {
      this.onError?.(`Could not analyse the microphone: ${err.message}`);
      this._releaseStream();
      return false;
    }

    const buffer = new Float32Array(this._analyser.fftSize);
    this.listening = true;
    this._emitState();

    this._vadTimer = setInterval(() => this._vadTick(buffer), VAD.POLL_MS);
    return true;
  }

  _vadTick(buffer) {
    if (this.micMuted || !this._analyser) return;

    this._analyser.getFloatTimeDomainData(buffer);
    let sum = 0;
    for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i];
    const rms = Math.sqrt(sum / buffer.length);

    const now      = Date.now();
    const isSpeech = rms >= VAD.SPEECH_RMS;

    if (!this._segmentOpen) {
      // Cool-down keeps Rāma's own spoken reply from opening a new segment
      if (isSpeech && now >= this._cooldownUntil) this._openSegment(now);
      return;
    }

    if (isSpeech) {
      this._silenceSince = 0;
      // Hard ceiling: one continuous noise source must not produce an endless clip
      if (now - this._segmentStart >= VAD.MAX_SEGMENT_MS) this._closeSegment(now);
      return;
    }

    if (!this._silenceSince) this._silenceSince = now;
    if (now - this._silenceSince >= VAD.SILENCE_MS) this._closeSegment(now);
  }

  _openSegment(now) {
    if (!this._stream) return;

    const mime = pickMime();
    this._chunks = [];
    try {
      this._recorder = new window.MediaRecorder(this._stream, mime ? { mimeType: mime } : undefined);
    } catch {
      return;   // recorder unavailable — VAD keeps running harmlessly
    }
    this._recorder.ondataavailable = (e) => { if (e.data?.size) this._chunks.push(e.data); };
    this._recorder.start(250);

    this._segmentOpen  = true;
    this._segmentStart = now;
    this._silenceSince = 0;
    this.recording     = true;
    this._emitState();
  }

  async _closeSegment(now) {
    const duration = now - this._segmentStart;
    this._segmentOpen  = false;
    this._silenceSince = 0;
    this.recording     = false;
    this._cooldownUntil = now + VAD.COOLDOWN_MS;
    this._emitState();

    const recorder = this._recorder;
    this._recorder = null;
    if (!recorder) return;

    const blob = await new Promise((resolve) => {
      recorder.onstop = () => resolve(new Blob(this._chunks, { type: recorder.mimeType || 'audio/webm' }));
      try { recorder.stop(); } catch { resolve(null); }
    });
    this._chunks = [];

    // Too short to be speech — discard rather than pay to transcribe noise
    if (!blob || duration < VAD.MIN_SEGMENT_MS || blob.size < 1200) return;

    await this._transcribeBlob(blob, { requireWake: false });
  }

  _stopHandsFree() {
    clearInterval(this._vadTimer);
    this._vadTimer     = null;
    this._segmentOpen  = false;
    this._silenceSince = 0;

    try { this._recorder?.stop(); } catch { /* ignore */ }
    this._recorder = null;
    this._chunks   = [];

    try { this._audioCtx?.close(); } catch { /* ignore */ }
    this._audioCtx = null;
    this._analyser = null;

    this._releaseStream();
    this.recording = false;
    this.listening = false;
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
    this._stopHandsFree();
    this._stopRecording();
    this._releaseStream();
    this._emitState();
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
    // Holding the button is an explicit request, so it works even when muted —
    // but it must not leave the mic open afterwards.
    const wasMuted = this.micMuted;
    if (wasMuted) this._pttOverrodeMute = true;

    const stream = await this._openStream();
    if (!stream) return false;

    const mime = pickMime();
    this._chunks   = [];
    try {
      this._recorder = new window.MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    } catch (err) {
      this.onError?.(`Recorder unavailable: ${err.message}`);
      this._releaseStream();
      return false;
    }
    this._recorder.ondataavailable = (e) => { if (e.data?.size) this._chunks.push(e.data); };
    this._recorder.start(250);
    this.recording = true;
    this._emitState();
    return true;
  }

  /** Acquire the microphone, reusing a live stream when one exists. */
  async _openStream() {
    if (this._stream?.active) return this._stream;
    try {
      this._stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
      });
      return this._stream;
    } catch (err) {
      this.onError?.(
        err.name === 'NotAllowedError'
          ? 'Microphone permission denied'
          : `Microphone unavailable: ${err.message}`
      );
      return null;
    }
  }

  /** Release the device so the OS mic indicator actually goes out. */
  _releaseStream() {
    try { this._stream?.getTracks().forEach(t => t.stop()); } catch { /* ignore */ }
    this._stream = null;
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

    // Push-to-talk while muted is a one-shot: restore the muted state after.
    if (this._pttOverrodeMute) {
      this._pttOverrodeMute = false;
      this._releaseStream();
    } else if (this.mode === MIC_MODES.HANDS_FREE && !this.micMuted) {
      // Resume the open mic that push-to-talk interrupted
      this._applyMode();
    }

    if (!blob || blob.size < 1200) {
      this.onError?.('Clip too short — hold the button while speaking');
      return null;
    }

    return this._transcribeBlob(blob, { requireWake: false });
  }

  /** Shared path: send a clip to the ladder and act on the result. */
  async _transcribeBlob(blob, { requireWake = false } = {}) {
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
    this._process(res.text, { requireWake });
    return res.text;
  }

  _stopRecording() {
    this.recording = false;
    this._recorder = null;
    this._chunks   = [];
    this._emitState();
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
    if (this.speechMuted) return false;   // muted means silent, not quieter
    window.speechSynthesis.cancel();

    // Hands-free is listening — give the utterance a cool-down window so Rāma
    // does not transcribe its own voice back as a command.
    this._cooldownUntil = Date.now() + Math.max(VAD.COOLDOWN_MS, text.length * 60);

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
/** Best container this browser will actually record. */
function pickMime() {
  if (typeof window === 'undefined' || !window.MediaRecorder) return '';
  return ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']
    .find(t => window.MediaRecorder.isTypeSupported?.(t)) || '';
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror   = () => reject(new Error('Could not read the audio clip'));
    reader.readAsDataURL(blob);
  });
}

export { VOICE_ACTIONS, WAKE_WORDS, VAD };
