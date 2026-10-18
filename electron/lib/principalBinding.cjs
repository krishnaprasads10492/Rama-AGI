'use strict';

/**
 * principalBinding — who is ACTUALLY on the other end of an IPC call (spec Section 150.1, D6).
 *
 * THE DEFECT. Every gated channel took `user` out of the call and believed it. The main process holds
 * the real session table (`authCore`, token to account, fingerprint-bound) and only the `auth:*`
 * channels ever consulted it, so any code running in a renderer could send `{ tier: 0 }` and be master.
 *
 * THE FIX IS TO BIND THE WINDOW, NOT TRUST THE PAYLOAD.
 *   1. When `auth:login-step2` or `auth:me` ACCEPTS a token, main records "this webContents authenticated
 *      with this token". The renderer cannot write that record; only those two handlers do, after
 *      `authCore` has said yes.
 *   2. On every call the window is resolved to an account by asking `authCore.validateSession` AGAIN. A
 *      revoked session, a suspended account or a changed tier therefore takes effect on the next request.
 *   3. `install()` wraps `ipcMain.handle` so any user the renderer sent is REPLACED by that principal
 *      before the handler sees it. 109 handlers destructure `{ user }`; none of them was edited.
 *
 * WHAT IT DOES NOT DO, deliberately:
 *   - It never INJECTS a user where none was sent. A payload that enumerates its keys (the egress body
 *     does) is left exactly as it was, and a channel that was already denying keeps denying.
 *   - It does not touch `auth:*` or `session:*`. Those carry tokens, and `tier` as DATA (`auth:set-tier`),
 *     and already validate against the session table. Rewriting them would corrupt them.
 *   - It does not stop code inside a window that is legitimately signed in from using that window's own
 *     authority. That is what a signed-in window is.
 *
 * THE ONE CHOKEPOINT. The recorder in `main.cjs` (`ipcRec`) says it "is not a policy layer and must not
 * become one", and many modules register on `ipcMain` directly. Only `ipcMain` itself is complete, so
 * this wraps it, and does so BEFORE any `register()` runs.
 *
 * Stdlib only, and `authCore` is injectable, so the whole thing runs under bare Node.
 */

const SKIP_PREFIXES = Object.freeze(['auth:', 'session:']);
const USER_KEYS = Object.freeze(['user', 'currentUser']);
const FORBIDDEN_KEYS = Object.freeze(['__proto__', 'constructor', 'prototype']);
const MAX_DEPTH = 3;
const INSTALLED = Symbol.for('rama.principalBinding.installed');

/** webContents id -> { token, fp } */
const bindings = new Map();
/** webContents id -> the destroyed-listener cleanup, so a window cannot leave a binding behind */
const watchers = new Map();

let auth = null;
function useAuth(a) { auth = a || null; }
function authCore() {
  if (auth) return auth;
  try { return require('./authCore.cjs'); } catch { return null; }
}

// ─── Binding ──────────────────────────────────────────────────────────────────

/**
 * Record that a window authenticated. Called ONLY from the handlers that have just had a token accepted.
 * @param {{id:number, once?:Function}} sender  the event's webContents
 */
function bind(sender, token, fingerprint) {
  const id = sender?.id;
  if (typeof id !== 'number' || !token) return false;
  bindings.set(id, { token: String(token), fp: String(fingerprint ?? '') });
  if (!watchers.has(id) && typeof sender.once === 'function') {
    try {
      sender.once('destroyed', () => unbind(id));
      watchers.set(id, true);
    } catch { /* a sender that cannot be watched is still validated on every call */ }
  }
  return true;
}

function unbind(id) { watchers.delete(id); return bindings.delete(id); }

function unbindToken(token) {
  let n = 0;
  for (const [id, b] of bindings) if (b.token === String(token ?? '')) { bindings.delete(id); n += 1; }
  return n;
}

function bindingFor(id) {
  const b = bindings.get(id);
  return b ? { token: b.token, fp: b.fp } : null;
}

/**
 * The account behind a window, rebuilt from the account record on this call, or null.
 * Never returns anything the renderer supplied.
 */
function principalFor(id) {
  const b = bindings.get(id);
  if (!b) return null;
  const core = authCore();
  if (!core) return null;
  try {
    const session = core.validateSession(b.token, b.fp);
    if (!session) { unbind(id); return null; }
    const account = core.findById(session.userId);
    if (!account || account.isActive === false) { unbind(id); return null; }
    return core.publicUser(account);
  } catch {
    // A locked store throws; "cannot tell who this is" must read as nobody, never as somebody.
    return null;
  }
}

/** For channels that want the principal directly and need no user in the payload at all. */
function getPrincipal(event) { return principalFor(event?.sender?.id); }

// ─── Sanitising ───────────────────────────────────────────────────────────────

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
  && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);

/**
 * Does this object CLAIM to be an account? A numeric `tier` beside an identifier. `token` and
 * `stepToken` mark a session payload, which is data about a session rather than a claim to be someone.
 */
function looksLikeUser(o) {
  if (!isPlain(o)) return false;
  if (typeof o.tier !== 'number') return false;
  if ('token' in o || 'stepToken' in o) return false;
  return 'id' in o || 'userId' in o || 'username' in o;
}

function hasClaim(v, depth = 0) {
  if (depth > MAX_DEPTH) return false;
  if (Array.isArray(v)) return v.some((x) => hasClaim(x, depth + 1));
  if (!isPlain(v)) return false;
  if (looksLikeUser(v)) return true;
  for (const k of Object.keys(v)) {
    if (USER_KEYS.includes(k)) return true;
    if (hasClaim(v[k], depth + 1)) return true;
  }
  return false;
}

function replaceClaims(v, principal, depth = 0) {
  if (depth > MAX_DEPTH) return v;
  if (Array.isArray(v)) return v.map((x) => replaceClaims(x, principal, depth + 1));
  if (!isPlain(v)) return v;
  if (looksLikeUser(v)) return principal;
  const out = {};
  for (const k of Object.keys(v)) {
    // `out['__proto__'] = x` SETS THE PROTOTYPE rather than a property. A structured-cloned payload can
    // carry that as an own key, and this copy is handed to a handler. Dropped, the way `genomeApplier`
    // refuses the same three names.
    if (FORBIDDEN_KEYS.includes(k)) continue;
    out[k] = USER_KEYS.includes(k) ? principal : replaceClaims(v[k], principal, depth + 1);
  }
  return out;
}

/**
 * @param {string} channel
 * @param {any[]} args           everything after the event
 * @param {() => object|null} getP  lazy, so a call with no claim never pays for session validation
 * @returns {{args:any[], replaced:boolean}}
 */
function sanitiseArgs(channel, args, getP) {
  const ch = String(channel || '');
  if (SKIP_PREFIXES.some((p) => ch.startsWith(p))) return { args, replaced: false };
  if (!args.some((a) => hasClaim(a))) return { args, replaced: false };
  const principal = getP();
  return { args: args.map((a) => replaceClaims(a, principal)), replaced: true };
}

// ─── Installation ─────────────────────────────────────────────────────────────

/**
 * Wrap `handle` and `handleOnce`. Idempotent. `ipcMain.on` is not wrapped: no listener carries a user
 * claim, and wrapping it would break `removeListener(channel, fn)` identity for the ones that matter.
 */
function install(ipcMain) {
  if (!ipcMain || ipcMain[INSTALLED]) return false;
  for (const method of ['handle', 'handleOnce']) {
    if (typeof ipcMain[method] !== 'function') continue;
    const original = ipcMain[method].bind(ipcMain);
    ipcMain[method] = (channel, fn) => original(channel, (event, ...args) => {
      let cached;
      let resolved = false;
      const getP = () => {
        if (!resolved) { cached = principalFor(event?.sender?.id); resolved = true; }
        return cached;
      };
      const out = sanitiseArgs(channel, args, getP);
      return fn(event, ...out.args);
    });
  }
  Object.defineProperty(ipcMain, INSTALLED, { value: true, enumerable: false });
  return true;
}

function reset() { bindings.clear(); watchers.clear(); }
function boundCount() { return bindings.size; }

module.exports = {
  bind, unbind, unbindToken, bindingFor, principalFor, getPrincipal,
  sanitiseArgs, looksLikeUser, hasClaim, replaceClaims,
  install, useAuth, reset, boundCount,
  SKIP_PREFIXES, USER_KEYS, MAX_DEPTH,
};
