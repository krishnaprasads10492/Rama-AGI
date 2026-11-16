'use strict';

/**
 * ipcGuard.cjs — one place that decides whether an IPC call is allowed to run (Section 196).
 *
 * WHY A GATE AT ALL. 370 handlers are registered across 43 files and 151 of them check who is
 * calling. The other 219 trust the message. Retrofitting each one means changing its preload member
 * and every renderer call site, which is a very large diff touching every feature — and the way that
 * goes wrong is a capability check that denies a legitimate user, which is the functionality master
 * said not to lose. So the decision moves to the boundary, where it can be declared as data, read in
 * one screen, and tightened one row at a time.
 *
 * WHAT IT CHECKS, in order:
 *
 *   1. THE SENDER. Only a window this app created may invoke anything. Nothing in the app sends IPC
 *      from anywhere else, so this cannot deny a legitimate caller — it removes the single
 *      assumption that, if it ever breaks, breaks every channel at once.
 *   2. THE POLICY. `self` and `observe` run; `cap:<name>` is enforced here; `bootstrap` and `public`
 *      run by declaration. An UNKNOWN channel is reported and allowed to run in observe mode,
 *      because a gate that blocks on arrival gets reverted, and a reverted gate protects nothing.
 *
 * EVERYTHING IS INJECTED — `ipcMain`, the policy, the capability layer, the clock and the reporter —
 * so the whole decision is drivable from a test with no Electron process, no window and no user.
 * That is the same seam Section 184.4 names as how this codebase does DIP, and it is why the
 * behaviour below can be asserted rather than described.
 *
 * WHAT IT DOES NOT DO. It does not authenticate: `user` arrives from the renderer and the capability
 * layer decides what that tier may do. A renderer that lies about its tier is a renderer that has
 * already been compromised, and the answer to that is the sender check above plus `contextIsolation`,
 * not a second guess here. It also does not sanitise arguments — a path or a command string is the
 * handler's business, and pretending otherwise would spread one responsibility across two files.
 */

/** The verdicts a policy row may carry. Anything else is a malformed table. */
const VERDICTS = Object.freeze(['self', 'bootstrap', 'public', 'observe']);

/** Installing twice would double-count every call and wrap every wrapper. */
const INSTALLED = Symbol.for('rama.ipcGuard.installed');

/** `cap:fs.write` → `fs.write`; anything else → null. */
function capOf(verdict) {
  if (typeof verdict !== 'string') return null;
  return verdict.startsWith('cap:') ? verdict.slice(4) || null : null;
}

function isKnownVerdict(verdict) {
  return VERDICTS.includes(verdict) || capOf(verdict) !== null;
}

/**
 * The denial shape every `invoke` handler in this app already returns, so a gate refusal is
 * indistinguishable to the renderer from a handler refusal and no page needs a second error path.
 */
function denial(reason) {
  return { ok: false, error: reason };
}

/**
 * Decide one call. PURE: no electron, no clock, no I/O.
 *
 * @param {object}   args
 * @param {string}   args.channel
 * @param {boolean}  args.senderTrusted  did this come from a window we created
 * @param {string}   args.verdict        the policy row, or undefined when unclassified
 * @param {object}   args.user           whatever the renderer passed, may be null
 * @param {function} args.can            `(user, cap) => boolean`
 * @returns {{allow:boolean, reason:string|null, record:string|null}}
 *          `record` names what a reader should be told about even when the call is allowed.
 */
function decide({ channel, senderTrusted, verdict, user, can }) {
  if (!senderTrusted) {
    return { allow: false, reason: `IPC refused: "${channel}" did not come from this application`,
      record: 'foreign-sender' };
  }
  if (verdict === undefined) {
    // UNCLASSIFIED IS REPORTED, NOT BLOCKED, and this is the deliberate soft edge of the design.
    // The alternative is an app that dies the first time someone adds a channel and forgets a row.
    return { allow: true, reason: null, record: 'unclassified' };
  }
  if (!isKnownVerdict(verdict)) {
    return { allow: true, reason: null, record: 'malformed-verdict' };
  }
  const cap = capOf(verdict);
  if (cap) {
    if (typeof can !== 'function') return { allow: true, reason: null, record: 'no-capability-layer' };
    if (!can(user, cap)) {
      return { allow: false, reason: `Not permitted: "${channel}" requires "${cap}"`, record: 'denied' };
    }
    return { allow: true, reason: null, record: null };
  }
  if (verdict === 'observe') return { allow: true, reason: null, record: 'observed' };
  return { allow: true, reason: null, record: null };
}

/**
 * Install the gate by wrapping `ipcMain.handle` and `ipcMain.on`.
 *
 * Returns a handle with the counters, so a caller can report what the gate saw without the gate
 * needing to know how anything is displayed.
 *
 * @param {object}   deps
 * @param {object}   deps.ipcMain      the real one, or a fake in a test
 * @param {object}   deps.policy       `{ [channel]: verdict }`
 * @param {function} deps.can          `(user, cap) => boolean`
 * @param {function} deps.isOurSender  `(event) => boolean`
 * @param {function} [deps.report]     called with each notable event; defaults to console.warn
 */
function install({ ipcMain, policy, can, isOurSender, principal, report } = {}) {
  if (!ipcMain || typeof ipcMain.handle !== 'function' || typeof ipcMain.on !== 'function') {
    throw new Error('ipcGuard.install needs an ipcMain with handle() and on()');
  }
  if (!policy || typeof policy !== 'object') throw new Error('ipcGuard.install needs a policy table');
  if (typeof isOurSender !== 'function') throw new Error('ipcGuard.install needs isOurSender()');
  /*
   * THE PRINCIPAL IS RESOLVED FROM THE WINDOW, NEVER FROM THE PAYLOAD, and this requirement is the
   * most important line in this file.
   *
   * Section 150.1 found that every gated channel took `user` out of the call and believed it, so any
   * code in a renderer could send `{ tier: 0 }` and be master. `principalBinding.cjs` fixed it by
   * replacing the claim with the account resolved from main's own session table. If this gate read
   * `args[0].user` it would reintroduce exactly that defect one layer higher — and worse, it would
   * look like a security control while being a way around one. So `principal(event)` is REQUIRED,
   * and the gate refuses to install without it rather than falling back to the payload.
   */
  if (typeof principal !== 'function') {
    throw new Error('ipcGuard.install needs principal(event) — the payload must never decide who is calling');
  }
  if (ipcMain[INSTALLED]) return null;

  const counts = { allowed: 0, refused: 0, observed: 0, unclassified: 0, foreign: 0 };
  const seen = { unclassified: new Set(), refused: new Set(), foreign: new Set() };
  const tell = typeof report === 'function' ? report : (msg) => console.warn(`[ipcGuard] ${msg}`);

  const guard = (channel, kind, run) => (event, ...args) => {
    const verdict = policy[channel];
    // The session table is only consulted when the verdict actually needs it, so a `public` or
    // `observe` channel costs nothing extra on every call.
    const needsUser = capOf(verdict) !== null;
    const outcome = decide({
      channel,
      senderTrusted: isOurSender(event),
      verdict,
      user: needsUser ? principal(event) : null,
      can,
    });

    // EVERY REFUSAL IS COUNTED ONCE, and each channel is NAMED once however often it is tried. A
    // compromised page calling the same channel in a loop must not be able to flood the log it would
    // be found in — the count keeps rising, the noise does not.
    if (outcome.record === 'foreign-sender') {
      counts.foreign += 1;
      counts.refused += 1;
      if (!seen.foreign.has(channel)) { seen.foreign.add(channel); tell(`REFUSED foreign sender on "${channel}"`); }
    } else if (outcome.record === 'unclassified') {
      counts.unclassified += 1;
      if (!seen.unclassified.has(channel)) {
        seen.unclassified.add(channel);
        tell(`"${channel}" has no policy row — add one to lib/ipcPolicy.cjs`);
      }
    } else if (outcome.record === 'denied') {
      counts.refused += 1;
      if (!seen.refused.has(channel)) { seen.refused.add(channel); tell(`DENIED "${channel}"`); }
    } else if (outcome.record === 'observed') {
      counts.observed += 1;
    }

    if (!outcome.allow) {
      // `on` is fire-and-forget: there is nobody to return a denial to, so the only correct action is
      // to not run the handler. `handle` gets the same `{ ok:false }` its handlers already return.
      return kind === 'on' ? undefined : denial(outcome.reason);
    }
    counts.allowed += 1;
    return run(event, ...args);
  };

  const realHandle = ipcMain.handle.bind(ipcMain);
  const realOn = ipcMain.on.bind(ipcMain);
  /*
   * ALL FOUR REGISTRATION METHODS, not the two obvious ones.
   *
   * `main.cjs` hands every subsystem an `ipcRec` recorder that forwards to `ipcMain.handle`,
   * `handleOnce`, `on` and `once`. Wrapping only `handle` and `on` would leave `handleOnce` and
   * `once` as an unguarded way in — not because anyone intended one, but because a gate that covers
   * most of a surface reads exactly like a gate that covers all of it. `ipcRec` forwards at CALL
   * time rather than capturing the function, so replacing these before any registration runs is
   * enough to put every subsystem behind the gate.
   */
  const real = {};
  for (const m of ['handle', 'handleOnce', 'on', 'once', 'removeListener', 'off']) {
    real[m] = typeof ipcMain[m] === 'function' ? ipcMain[m].bind(ipcMain) : null;
  }

  /*
   * LISTENER IDENTITY IS PRESERVED, because wrapping `on` silently breaks removal.
   *
   * `emitter.removeListener(channel, fn)` matches by reference. Once `on` registers a wrapper, the
   * caller's `fn` is not the registered function and removal becomes a no-op that reports success —
   * a leak with no error anywhere. `principalBinding` avoided this by not wrapping `on` at all, and
   * that is the right call for its job because no listener carries a user claim. This gate does need
   * `on`: `terminal:write` is a listener, and it is one of the channels 196.2 names as reachable by
   * a tier that may not open a terminal in the first place.
   *
   * So the mapping is kept and `removeListener`/`off` translate through it.
   */
  const wrappers = new Map(); // channel -> Map(originalFn -> wrappedFn)
  const remember = (channel, fn, wrapped) => {
    if (!wrappers.has(channel)) wrappers.set(channel, new Map());
    wrappers.get(channel).set(fn, wrapped);
    return wrapped;
  };
  const recall = (channel, fn) => wrappers.get(channel)?.get(fn) || fn;

  ipcMain.handle = (channel, fn) => real.handle(channel, guard(channel, 'handle', fn));
  if (real.handleOnce) {
    ipcMain.handleOnce = (channel, fn) => real.handleOnce(channel, guard(channel, 'handle', fn));
  }
  ipcMain.on = (channel, fn) => real.on(channel, remember(channel, fn, guard(channel, 'on', fn)));
  if (real.once) {
    ipcMain.once = (channel, fn) => real.once(channel, remember(channel, fn, guard(channel, 'on', fn)));
  }
  if (real.removeListener) {
    ipcMain.removeListener = (channel, fn) => real.removeListener(channel, recall(channel, fn));
  }
  if (real.off) ipcMain.off = (channel, fn) => real.off(channel, recall(channel, fn));

  // `configurable` so `uninstall()` can delete it — without it the delete throws under 'use strict'
  // and a test that installs twice would fail for a reason that has nothing to do with the gate.
  Object.defineProperty(ipcMain, INSTALLED, { value: true, enumerable: false, configurable: true });

  return {
    counts,
    unclassified: () => [...seen.unclassified],
    /** Restore the real methods. Exists for tests; nothing in the app uninstalls the gate. */
    uninstall: () => {
      for (const [m, fn] of Object.entries(real)) if (fn) ipcMain[m] = fn;
      wrappers.clear();
      delete ipcMain[INSTALLED];
    },
  };
}

/**
 * Is this event from a window we created?
 *
 * Built here rather than inlined at the call site so the rule has one definition. A sender is trusted
 * when its `webContents` belongs to a BrowserWindow this process owns. A frame that is not the main
 * frame of such a window — an iframe, or anything loaded into one — is NOT trusted, which is the
 * case the check exists for.
 */
function senderCheck({ BrowserWindow }) {
  return (event) => {
    if (!event || !event.sender) return false;
    try {
      const ours = BrowserWindow.getAllWindows().some((w) => w.webContents?.id === event.sender.id);
      if (!ours) return false;
      // `senderFrame` is absent on `sendSync` in some versions; absence is not evidence of a foreign
      // frame, so it only disqualifies when present AND not the main frame.
      const frame = event.senderFrame;
      if (frame && frame.parent) return false;
      return true;
    } catch {
      return false;
    }
  };
}

module.exports = { install, decide, senderCheck, capOf, isKnownVerdict, denial, VERDICTS };
