'use strict';

/**
 * voiceEngine.cjs — transcription backends for Rāma's voice capability.
 *
 * WHY THIS EXISTS: `webkitSpeechRecognition` cannot work in the Electron shell.
 * Chromium is built without the Google API keys Chrome ships with, and Google
 * withdrew Web Speech support for non-Chrome Chromium shells, so every attempt
 * fails with `network`. The renderer used to retry it every 300ms forever.
 *
 * THE LADDER (spec section 30) — resolution order is local before cloud,
 * because private and free beats accurate and paid:
 *
 *   level 2  LOCAL STT   a Whisper binary on PATH or configured
 *   level 3  CLOUD STT   an OpenAI key in the credential vault
 *
 * Levels 0 (text) and 1 (capture) are renderer concerns. This module answers
 * two questions: what can this machine transcribe with, and transcribe this clip.
 *
 * Nothing here throws on absence. A missing backend lowers the reported level
 * and names what would raise it.
 */

const fs      = require('fs');
const os      = require('os');
const path    = require('path');
const crypto  = require('crypto');
const { spawnSync, spawn } = require('child_process');

const net = require('../lib/http.cjs');

// ─── Local Whisper discovery ──────────────────────────────────────────────────
// Checked once per process and cached: probing the filesystem on every utterance
// would be wasteful, and a binary does not appear mid-session.
let _localCache = undefined;

// Deliberately no bare `main` here. whisper.cpp's legacy binary was called
// `main`, but probing for that name on Windows resolves C:\Windows\System32\
// main.cpl — a Control Panel applet. A name match is not a capability; every
// candidate below is executed and must identify itself as Whisper.
const WHISPER_CANDIDATES = ['whisper-cli', 'whisper', 'faster-whisper', 'whisper-cpp'];

const IS_WIN = os.platform() === 'win32';

// Only these are actually runnable as commands on Windows
const WIN_EXEC_EXT = new Set(['.exe', '.cmd', '.bat', '.com']);

function which(cmd) {
  try {
    const r = spawnSync(IS_WIN ? 'where' : 'which', [cmd], { encoding: 'utf8', timeout: 4000 });
    if (r.status !== 0) return null;

    const hits = String(r.stdout).split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    for (const hit of hits) {
      if (!IS_WIN) return hit;
      if (WIN_EXEC_EXT.has(path.extname(hit).toLowerCase())) return hit;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Run the candidate and require it to identify itself as Whisper. This is the
 * difference between "a file with that name exists" and "this machine can
 * transcribe" — the ladder must only climb on the latter.
 */
function validateWhisper(binary) {
  for (const args of [['--help'], ['-h']]) {
    try {
      const r = spawnSync(binary, args, {
        encoding: 'utf8', timeout: 15_000, windowsHide: true,
      });
      const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.toLowerCase();
      if (/whisper|transcrib/.test(out)) return true;
    } catch { /* try the next form */ }
  }
  return false;
}

/**
 * @returns {{available:boolean, binary?:string, kind?:string, model?:string, reason?:string}}
 */
function detectLocal() {
  if (_localCache !== undefined) return _localCache;

  const model = process.env.RAMA_WHISPER_MODEL || null;

  // An explicit path wins — the user may have it outside PATH. Still validated:
  // a wrong path here would otherwise fail on every utterance instead of now.
  const configured = process.env.RAMA_WHISPER_PATH;
  if (configured) {
    if (!fs.existsSync(configured)) {
      _localCache = {
        available: false,
        reason: `RAMA_WHISPER_PATH points at a file that does not exist: ${configured}`,
        hint: 'Correct RAMA_WHISPER_PATH or unset it to search PATH instead',
      };
      return _localCache;
    }
    if (validateWhisper(configured)) {
      _localCache = { available: true, binary: configured, kind: 'configured', model };
      return _localCache;
    }
    _localCache = {
      available: false,
      reason: `RAMA_WHISPER_PATH is not a Whisper executable: ${configured}`,
      hint: 'Point RAMA_WHISPER_PATH at whisper-cli (whisper.cpp) or the whisper CLI',
    };
    return _localCache;
  }

  const rejected = [];
  for (const cmd of WHISPER_CANDIDATES) {
    const found = which(cmd);
    if (!found) continue;
    if (validateWhisper(found)) {
      _localCache = { available: true, binary: found, kind: cmd, model };
      return _localCache;
    }
    rejected.push(`${found} did not identify as Whisper`);
  }

  _localCache = {
    available: false,
    reason: rejected.length
      ? `No usable Whisper binary — ${rejected.join('; ')}`
      : 'No Whisper binary found on PATH',
    hint: 'Install whisper.cpp (provides whisper-cli) or run `pip install openai-whisper`, '
        + 'or set RAMA_WHISPER_PATH to the executable',
  };
  return _localCache;
}

/** Forget the cached probe — used after the user installs something. */
function rescanLocal() { _localCache = undefined; return detectLocal(); }

// ─── Cloud availability ───────────────────────────────────────────────────────
//
// AUDIO STAYS ON THIS MACHINE UNLESS MASTER SAYS OTHERWISE (Section 150.3, D8). A key in the vault used to
// be enough: adding OPENAI_API_KEY for some other purpose silently made every voice clip go to
// api.openai.com. Cloud transcription now needs ALL of
//   1. an OPENAI_API_KEY in the vault,
//   2. master's explicit opt-in, stored in the encrypted `config` domain (so it is inside the I14 re-key),
//      default OFF, changeable only by master, and
//   3. a signed-in session holding `chat.send` (checked in the IPC handler).
// Audio cannot be classified before it is transcribed, so there is no content gate to apply: the decision
// is about the whole path, which is why it is explicit and off by default.
const OPT_IN_DOMAIN = 'config';
const OPT_IN_KEY = 'voiceCloudSttOptIn';

/** Has master opted in? Strictly `true`: anything else, including a locked store, means no. */
function cloudOptIn() {
  try { return require('../dataStore.cjs').get(OPT_IN_DOMAIN, OPT_IN_KEY) === true; }
  catch { return false; }
}

/** Record the opt-in. Saved at once: a consent that lives only in memory is a consent that can vanish. */
function setCloudOptIn(enabled) {
  const ds = require('../dataStore.cjs');
  ds.set(OPT_IN_DOMAIN, OPT_IN_KEY, enabled === true);
  if (typeof ds.saveDomain === 'function') ds.saveDomain(OPT_IN_DOMAIN);
  return enabled === true;
}

function detectCloud() {
  const optedIn = cloudOptIn();
  try {
    const { getCredential } = require('./credentialVault.cjs');
    const key = getCredential('OPENAI_API_KEY');
    if (key && optedIn) {
      return { available: true, provider: 'openai', model: 'whisper-1', keyPresent: true, optedIn: true,
               leavesMachine: true };
    }
    if (key) {
      return {
        available: false, keyPresent: true, optedIn: false,
        reason: 'Cloud transcription is possible (a key is in the vault) but master has not opted in, so audio stays on this machine',
        hint: 'To allow it, master opts in under Settings, Security, Cloud speech-to-text. Local Whisper needs no opt-in',
      };
    }
    return {
      available: false, keyPresent: false, optedIn,
      reason: 'No OpenAI key in the credential vault',
      hint: 'Cloud transcription needs OPENAI_API_KEY on the Models page AND master\'s opt-in under Settings, Security',
    };
  } catch (err) {
    return { available: false, keyPresent: false, optedIn, reason: `Vault unavailable: ${err.message}` };
  }
}

// ─── Capability report ────────────────────────────────────────────────────────
/**
 * The highest level this machine can reach, and what the next one needs.
 * Level 4 (wake word) requires a *local* engine on purpose: streaming ambient
 * audio to a paid API to listen for a wake word is the wrong trade.
 */
function capabilities() {
  const local = detectLocal();
  const cloud = detectCloud();

  let level = 1;                       // capture is a renderer capability
  let backend = null;

  if (cloud.available) { level = 3; backend = 'cloud'; }
  if (local.available) { level = 2; backend = 'local'; }   // local preferred

  const canTranscribe = local.available || cloud.available;
  if (!canTranscribe) level = 0;

  return {
    level,
    levelName: ['TEXT', 'PUSH-TO-TALK', 'LOCAL STT', 'CLOUD STT', 'WAKE WORD'][level] ?? 'TEXT',
    canTranscribe,
    // Wake word needs continuous local recognition — cloud does not qualify
    wakeWordCapable: local.available,
    backend,
    local,
    cloud,
    nextStep: local.available
      ? (cloud.available ? null : cloud.hint ?? null)
      : (local.hint ?? null),
  };
}

// ─── Transcription ────────────────────────────────────────────────────────────
function tempClipPath(ext) {
  return path.join(os.tmpdir(), `rama-voice-${crypto.randomBytes(6).toString('hex')}.${ext}`);
}

function shred(file) {
  // Voice clips are private. Overwrite before unlinking rather than leaving the
  // bytes recoverable in the temp directory.
  try {
    if (!fs.existsSync(file)) return;
    const size = fs.statSync(file).size;
    if (size > 0) fs.writeFileSync(file, crypto.randomBytes(size));
    fs.unlinkSync(file);
  } catch { /* best effort */ }
}

/** Run a local Whisper binary over a clip. Resolves text or an error. */
function transcribeLocal(clipPath, binaryInfo, language = 'en') {
  return new Promise((resolve) => {
    const outBase = clipPath.replace(/\.[^.]+$/, '');
    const isCpp   = /whisper-cli|whisper-cpp/i.test(binaryInfo.binary);

    const args = isCpp
      ? ['-f', clipPath, '-l', language, '-otxt', '-of', outBase, '-nt',
         ...(binaryInfo.model ? ['-m', binaryInfo.model] : [])]
      : [clipPath, '--language', language, '--output_format', 'txt',
         '--output_dir', path.dirname(clipPath), '--fp16', 'False',
         ...(binaryInfo.model ? ['--model', binaryInfo.model] : ['--model', 'base'])];

    const proc = spawn(binaryInfo.binary, args, { timeout: 120_000, windowsHide: true });

    let stderr = '';
    proc.stderr?.on('data', d => { stderr += d; });

    proc.on('error', (err) => resolve({ ok: false, error: `Local STT failed to start: ${err.message}` }));

    proc.on('close', (code) => {
      const txtPath = `${outBase}.txt`;
      try {
        if (fs.existsSync(txtPath)) {
          const text = fs.readFileSync(txtPath, 'utf8').trim();
          shred(txtPath);
          if (text) return resolve({ ok: true, text, backend: 'local', engine: binaryInfo.kind });
        }
      } catch { /* fall through to the error path */ }

      resolve({
        ok: false,
        error: code === 0
          ? 'Local STT produced no text'
          : `Local STT exited ${code}: ${stderr.slice(-200).trim() || 'no output'}`,
      });
    });
  });
}

/** Send a clip to OpenAI's transcription endpoint using a vault key. */
async function transcribeCloud(clipPath, mimeType = 'audio/webm', language = 'en') {
  const { getCredential } = require('./credentialVault.cjs');
  const key = getCredential('OPENAI_API_KEY');
  if (!key) return { ok: false, error: 'No OpenAI key in the vault' };

  const boundary = `----rama${crypto.randomBytes(12).toString('hex')}`;
  const audio    = fs.readFileSync(clipPath);
  const filename = path.basename(clipPath);

  const field = (name, value) =>
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`, 'utf8');

  const body = Buffer.concat([
    field('model', 'whisper-1'),
    field('language', language),
    field('response_format', 'json'),
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n`
      + `Content-Type: ${mimeType}\r\n\r\n`, 'utf8'),
    audio,
    Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8'),
  ]);

  const res = await net.request('https://api.openai.com/v1/audio/transcriptions', {
    method:  'POST',
    body,
    timeout: 60_000,
    retries: 1,
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type':  `multipart/form-data; boundary=${boundary}`,
    },
  });

  if (!res.body) return { ok: false, error: res.error || `HTTP ${res.status}` };

  try {
    const parsed = JSON.parse(res.body);
    if (parsed.error) return { ok: false, error: parsed.error.message || 'Transcription rejected' };
    const text = String(parsed.text ?? '').trim();
    return text
      ? { ok: true, text, backend: 'cloud', engine: 'whisper-1' }
      : { ok: false, error: 'Cloud STT returned no text' };
  } catch {
    return { ok: false, error: 'Cloud STT returned an unreadable response' };
  }
}

/**
 * Transcribe a clip captured in the renderer.
 * Tries local first, then cloud. Never throws; on total failure it says what
 * would make transcription possible.
 *
 * @param {object} clip { data: base64 string, mimeType, language }
 */
async function transcribe(clip = {}) {
  const { data, mimeType = 'audio/webm', language = 'en' } = clip;
  if (!data) return { ok: false, error: 'No audio supplied' };

  const ext      = mimeType.includes('wav') ? 'wav' : mimeType.includes('ogg') ? 'ogg' : 'webm';
  const clipPath = tempClipPath(ext);

  try {
    fs.writeFileSync(clipPath, Buffer.from(data, 'base64'));

    const local = detectLocal();
    if (local.available) {
      const res = await transcribeLocal(clipPath, local, language);
      if (res.ok) return res;
      console.warn('[voice] local STT failed, trying cloud:', res.error);
    }

    const cloud = detectCloud();
    if (cloud.available) {
      const res = await transcribeCloud(clipPath, mimeType, language);
      // REPORTED WHETHER OR NOT IT SUCCEEDED: the clip left the machine the moment the request was made.
      // A failure that read as "nothing was sent" would be a lie about master's voice.
      return { ...res, leftMachine: true, provider: 'openai' };
    }

    return {
      ok: false,
      error: 'No transcription backend is available on this machine',
      hint: [local.hint, cloud.hint].filter(Boolean).join(' — or — '),
      capabilities: capabilities(),
    };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    shred(clipPath);
  }
}

// ─── IPC ──────────────────────────────────────────────────────────────────────
function register(ipcMain) {
  const principalBinding = require('../lib/principalBinding.cjs');
  const capability = require('../lib/capability.cjs');

  ipcMain.handle('voice:capabilities', async () => ({ ok: true, data: capabilities() }));

  // Whether cloud transcription is allowed, and why or why not. Any signed-in session may ask.
  ipcMain.handle('voice:cloud-optin', async (e) => {
    if (!principalBinding.getPrincipal(e)) return { ok: false, error: 'Sign in first' };
    const c = detectCloud();
    return { ok: true, data: { optedIn: cloudOptIn(), keyPresent: c.keyPresent === true, available: c.available === true } };
  });

  // MASTER ONLY, from the account main validated for this window, never from a user the caller sent.
  ipcMain.handle('voice:set-cloud-optin', async (e, opts) => {
    const principal = principalBinding.getPrincipal(e);
    if (!capability.isMaster(principal)) {
      return { ok: false, error: 'Only master can allow audio to leave this machine' };
    }
    try {
      const optedIn = setCloudOptIn(opts && opts.enabled === true);
      rescanLocal();
      const c = detectCloud();
      return { ok: true, data: { optedIn, keyPresent: c.keyPresent === true, available: c.available === true } };
    } catch (err) {
      return { ok: false, error: `could not record the choice: ${err.message}` };
    }
  });

  ipcMain.handle('voice:rescan', async () => {
    rescanLocal();
    return { ok: true, data: capabilities() };
  });

  ipcMain.handle('voice:transcribe', async (e, clip) => {
    // A SESSION IS REQUIRED for any transcription, local or cloud (Section 150.3). This channel had no
    // check at all. `chat.send` is the weakest declared chat capability: what is being gated is "may this
    // account talk to Rāma", and voice is another way of doing that.
    const denied = capability.deny(principalBinding.getPrincipal(e), 'chat.send');
    if (denied) return denied;
    const res = await transcribe(clip || {});

    // Feed the experiential dataset so Rāma learns which backend serves it best
    try {
      require('./metaCognition.cjs').recordOutcome({
        action: 'voice-transcribe',
        ok:     res.ok,
        tool:   res.backend ?? 'none',
        error:  res.ok ? null : res.error,
      });
    } catch { /* metacognition optional */ }

    return res;
  });
}

module.exports = {
  register, capabilities, transcribe,
  detectLocal, detectCloud, rescanLocal, cloudOptIn, setCloudOptIn,
};
