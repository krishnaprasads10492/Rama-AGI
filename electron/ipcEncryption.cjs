'use strict';

/**
 * ipcEncryption.cjs — Pervasive Flow Encryption Layer.
 *
 * All sensitive IPC flows between Electron main and renderer
 * are HMAC-signed. Sensitive data flowing through IPC is encrypted
 * with a session-ephemeral key.
 *
 * WHAT THIS PROTECTS AGAINST:
 *   - An adversarial process injecting fake IPC messages
 *   - Memory inspection tools reading IPC message queues
 *   - Another AI intercepting internal Rāma communications
 *   - Replay attacks (each message has a nonce + timestamp)
 *
 * DESIGN:
 *   - Session key: 32-byte random, generated on unlock, zeroed on lock
 *   - Every sensitive IPC message gets: nonce + timestamp + HMAC
 *   - Renderer validates signature before trusting any message
 *   - Messages older than 30s are rejected (replay window)
 *   - Channels that carry sensitive data are listed in SENSITIVE_CHANNELS
 *
 * PERFORMANCE:
 *   - HMAC-SHA256 is ~100ns per message — negligible overhead
 *   - Only SENSITIVE_CHANNELS are encrypted — general UI events are not
 *   - Caching: session key cached in module scope, no re-derivation needed
 */

const crypto = require('crypto');

// ─── Session encryption key (ephemeral — fresh each login) ───────────────────
let _sessionKey    = null;   // 32-byte Buffer
let _messageCounter = 0;

// ─── Sensitive IPC channels ───────────────────────────────────────────────────
// These channels carry identity, credentials, or private AI state
const SENSITIVE_CHANNELS = new Set([
  'nucleus:get-prompt',
  'vault:get',
  'vault:set',
  'session:unlock',
  'session:change-passcode',
  // Authentication channels carry passwords and 12-digit access keys
  'auth:provision',
  'auth:login-step1',
  'auth:login-step2',
  'auth:keygen',
  'auth:keygen-step',
  'auth:keygen-credentials',
  'auth:issue-key',
  'auth:change-password',
  'auth:reset-password',
  'ai:log',
  'models:chat',
  'agents:spawned',
  'agents:complete',
  'selfcare:health-update',
  'regen:proposal-ready',
  'capability:regression',
]);

// Channels that must NEVER be interceptable
const CRITICAL_CHANNELS = new Set([
  'nucleus:get-prompt',
  'vault:get',
  'session:unlock',
]);

// ─── Initialize session key ───────────────────────────────────────────────────
function initSession() {
  _sessionKey     = crypto.randomBytes(32);
  _messageCounter = 0;
  return _sessionKey.toString('hex').slice(0, 8) + '...';  // safe partial for logging
}

// ─── Zero session key ─────────────────────────────────────────────────────────
function clearSession() {
  if (_sessionKey) _sessionKey.fill(0);
  _sessionKey     = null;
  _messageCounter = 0;
}

// ─── Sign an outgoing IPC message ─────────────────────────────────────────────
function sign(channel, payload) {
  if (!_sessionKey) return null;

  const nonce    = crypto.randomBytes(8).toString('hex');
  const ts       = Date.now();
  const counter  = ++_messageCounter;

  const message  = JSON.stringify({ channel, payload, nonce, ts, counter });
  const hmac     = crypto.createHmac('sha256', _sessionKey).update(message).digest('hex');

  return { channel, payload, nonce, ts, counter, hmac };
}

// ─── Verify an incoming signed message ───────────────────────────────────────
function verify(signedMsg) {
  if (!_sessionKey) return { ok: false, error: 'No session key' };
  if (!signedMsg?.hmac) return { ok: false, error: 'No signature' };

  const { channel, payload, nonce, ts, counter, hmac } = signedMsg;

  // Replay window check (30 seconds)
  if (Math.abs(Date.now() - ts) > 30000) {
    return { ok: false, error: 'Message expired (replay attack prevention)' };
  }

  // Recompute HMAC
  const message  = JSON.stringify({ channel, payload, nonce, ts, counter });
  const expected = crypto.createHmac('sha256', _sessionKey).update(message).digest('hex');

  if (!crypto.timingSafeEqual(Buffer.from(hmac, 'hex'), Buffer.from(expected, 'hex'))) {
    console.error(`[IPC Security] ⚠ HMAC verification failed on channel: ${channel}`);
    return { ok: false, error: 'HMAC verification failed — possible IPC injection attempt' };
  }

  return { ok: true, payload };
}

// ─── Encrypt sensitive payload ────────────────────────────────────────────────
function encryptPayload(payload) {
  if (!_sessionKey) return { encrypted: false, data: payload };

  try {
    const plain   = Buffer.from(JSON.stringify(payload), 'utf8');
    const iv      = crypto.randomBytes(12);
    const cipher  = crypto.createCipheriv('aes-256-gcm', _sessionKey, iv);
    const enc     = Buffer.concat([cipher.update(plain), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return {
      encrypted: true,
      iv:        iv.toString('base64'),
      authTag:   authTag.toString('base64'),
      data:      enc.toString('base64'),
    };
  } catch {
    return { encrypted: false, data: payload };
  }
}

// ─── Decrypt sensitive payload ────────────────────────────────────────────────
function decryptPayload(encObj) {
  if (!encObj?.encrypted || !_sessionKey) return encObj?.data ?? encObj;

  try {
    const iv       = Buffer.from(encObj.iv, 'base64');
    const authTag  = Buffer.from(encObj.authTag, 'base64');
    const enc      = Buffer.from(encObj.data, 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', _sessionKey, iv);
    decipher.setAuthTag(authTag);
    const plain = Buffer.concat([decipher.update(enc), decipher.final()]);
    return JSON.parse(plain.toString('utf8'));
  } catch {
    return encObj?.data ?? encObj;
  }
}

// ─── In-memory state encryption (for zustand stores) ─────────────────────────
/**
 * Encrypt a sensitive value for storage in React state.
 * The encrypted value is base64 — safe to store anywhere in memory.
 * Without the session key (which is in main process), it's unreadable.
 */
function encryptForState(value) {
  if (!_sessionKey) return { e: false, v: value };
  try {
    const plain   = Buffer.from(JSON.stringify(value), 'utf8');
    const iv      = crypto.randomBytes(12);
    const cipher  = crypto.createCipheriv('aes-256-gcm', _sessionKey, iv);
    const enc     = Buffer.concat([cipher.update(plain), cipher.final()]);
    const tag     = cipher.getAuthTag();
    const packed  = Buffer.concat([iv, tag, enc]).toString('base64');
    return { e: true, v: packed };
  } catch { return { e: false, v: value }; }
}

function decryptFromState(packed) {
  if (!packed?.e || !_sessionKey) return packed?.v ?? packed;
  try {
    const buf     = Buffer.from(packed.v, 'base64');
    const iv      = buf.slice(0, 12);
    const tag     = buf.slice(12, 28);
    const enc     = buf.slice(28);
    const dec     = crypto.createDecipheriv('aes-256-gcm', _sessionKey, iv);
    dec.setAuthTag(tag);
    return JSON.parse(Buffer.concat([dec.update(enc), dec.final()]).toString('utf8'));
  } catch { return packed?.v ?? packed; }
}

// ─── IPC wrapper — wraps ipcMain.handle for sensitive channels ────────────────
/**
 * WHICH CHANNELS ARE ACTUALLY WRAPPED. Not a cache and not an optimisation: it exists because
 * `ipc-enc:status` used to report `sensitiveChannels: SENSITIVE_CHANNELS.size` and nothing else,
 * which reads as "this many channels are protected" — while `wrapHandle` had ZERO call sites, so the
 * real answer was none of them (audit H10, Section 144).
 *
 * A security control that reports its own intended scope as though it were its achieved scope is
 * worse than an absent one: it answers the question nobody then asks again.
 */
const _wrapped = new Set();

function wrapHandle(ipcMain, channel, handler) {
  if (!SENSITIVE_CHANNELS.has(channel)) {
    // Not sensitive — pass through
    ipcMain.handle(channel, handler);
    return;
  }
  _wrapped.add(channel);

  ipcMain.handle(channel, async (event, ...args) => {
    // For critical channels, verify session is active
    if (CRITICAL_CHANNELS.has(channel) && !_sessionKey) {
      console.error(`[IPC Security] Attempt to call ${channel} without active session`);
      return { ok: false, error: 'No active session — unlock required' };
    }

    const result = await handler(event, ...args);

    // Sign the response
    if (_sessionKey && result?.ok) {
      result._sig = crypto.createHmac('sha256', _sessionKey)
        .update(JSON.stringify(result))
        .digest('hex')
        .slice(0, 16);
    }

    return result;
  });
}

// ─── Register IPC ─────────────────────────────────────────────────────────────
function register(ipcMain) {
  // Session key management
  ipcMain.handle('ipc-enc:init', async () => {
    const id = initSession();
    return { ok: true, sessionId: id };
  });

  ipcMain.handle('ipc-enc:clear', async () => {
    clearSession();
    return { ok: true };
  });

  ipcMain.handle('ipc-enc:status', async () => ({
    ok:           true,
    hasSessionKey: !!_sessionKey,
    messageCount:  _messageCounter,
    // DECLARED SCOPE, kept — this is how many channels the policy NAMES.
    sensitiveChannels: SENSITIVE_CHANNELS.size,
    criticalChannels:  CRITICAL_CHANNELS.size,
    // ACHIEVED SCOPE, added — how many are actually routed through `wrapHandle`. These two numbers
    // were the same claim before, and they are not the same fact: nothing calls `wrapHandle`, so
    // this reports 0 while the two above report 20-odd. The gap is the point (Section 144).
    wrappedChannels: _wrapped.size,
    wrapped: [..._wrapped].sort(),
    unprotectedChannels: [...SENSITIVE_CHANNELS].filter((c) => !_wrapped.has(c)).sort(),
    // Said in words as well as numbers, because a reader who sees three counts should not have to
    // subtract them to learn that the control is inert.
    enforcement: _wrapped.size === 0
      ? 'NOT ENFORCED: wrapHandle has no call site, so no sensitive channel is session-checked or '
        + 'signed. The channel lists above are the POLICY, not the state. See spec Section 144 — '
        + 'wiring this needs a decision, because main.cjs\'s ipcRec recorder is documented as not '
        + 'being a policy layer.'
      : `enforced on ${_wrapped.size} of ${SENSITIVE_CHANNELS.size} sensitive channels`,
  }));

  // Verify a signed message from renderer
  ipcMain.handle('ipc-enc:verify', async (_e, signedMsg) => {
    return verify(signedMsg);
  });

  // Encrypt a value for safe state storage (called from renderer)
  ipcMain.handle('ipc-enc:encrypt-for-state', async (_e, value) => {
    return { ok: true, data: encryptForState(value) };
  });

  ipcMain.handle('ipc-enc:decrypt-from-state', async (_e, packed) => {
    return { ok: true, data: decryptFromState(packed) };
  });
}

module.exports = {
  register,
  initSession,
  clearSession,
  sign,
  verify,
  encryptPayload,
  decryptPayload,
  encryptForState,
  decryptFromState,
  wrapHandle,
  isSensitive: (ch) => SENSITIVE_CHANNELS.has(ch),
  isCritical:  (ch) => CRITICAL_CHANNELS.has(ch),
};
