'use strict';

/**
 * ipcGate.cjs — the one authorisation line every gated IPC handler needs (Section 197).
 *
 * THE DUPLICATION THIS REMOVES. Six modules each defined their own `gated(cap, fn)` decorator, and
 * every one of them opened with the same line:
 *
 *     const denied = capability.deny(principalBinding.getPrincipal(e), cap);
 *
 * Six copies of the single decision that says who may call a channel. Each copy is a place that can
 * drift — one of them resolving the principal differently, or reading `user` from the payload after
 * Section 150.1 established that nothing may — and the only way to know they still agree was to read
 * all six. That is the cost duplication actually charges: not the lines, the re-reading.
 *
 * WHAT IS **NOT** CONSOLIDATED, and this is the design decision rather than an omission.
 *
 * The six decorators differ on four axes: how the handler is invoked (`fn(body)`, `fn()`,
 * `fn(e, ...args)`), whether a store-unlocked precondition applies, whether errors are redacted, and
 * whether errors are caught at all. A single decorator serving all six would need four options, and
 * **four branches inside the function that decides access is a worse object than four small
 * functions that each do one thing.** Options are how a shared helper becomes a configurable monster
 * that nobody can reason about at the one moment it matters.
 *
 * So the DECISION is shared and the PLUMBING stays local. Each module keeps its own three-line
 * decorator in its own calling convention, and all of them ask the same question here.
 *
 * ON OVERLOADING, since it was asked for: JavaScript has none. The honest equivalents are a default
 * parameter, an options object, and data-driven dispatch — and this file deliberately uses the first
 * and refuses the second for the reason above. Overriding is not available either: the codebase has
 * six class declarations, every one extending Error, EventEmitter or React.Component (184.4), so
 * there is no inheritance chain to override into. Reuse here means a shared function, not a subclass.
 *
 * `principal` and `can` are injectable so the decision can be driven from a suite with no Electron,
 * no window and no session table — the same seam the rest of this directory uses.
 */

const capability = require('./capability.cjs');
const principalBinding = require('./principalBinding.cjs');

/**
 * May the window behind this event use `cap`?
 *
 * @param {object} event        the IPC event; its `sender` identifies the window
 * @param {string} cap          a capability name from shared/capabilities.json
 * @param {object} [deps]       injection seam for tests
 * @param {function} [deps.principal]  `(event) => user|null`
 * @param {function} [deps.can]        `(user, cap) => boolean`
 * @returns {null | {ok:false, error:string}}  null when allowed, the denial to return when not
 *
 * THE PRINCIPAL COMES FROM THE WINDOW, NEVER FROM THE PAYLOAD. That is the whole point of
 * `principalBinding` (Section 150.1): a renderer that sends `{ tier: 0 }` must not become master.
 * Passing a user in here is therefore not supported, and that is a feature.
 */
function denyEvent(event, cap, { principal, can } = {}) {
  const who = typeof principal === 'function'
    ? principal(event)
    : principalBinding.getPrincipal(event);
  if (typeof can === 'function') {
    // The injected path still produces the real denial shape, so a test sees what a caller sees.
    return can(who, cap) ? null : capability.deny(null, cap);
  }
  return capability.deny(who, cap);
}

/**
 * The plain decorator: authorise, then run the handler with the body.
 *
 * Offered for the shape that occurs most often — `(cap, fn) => async (e, body) => fn(body)` — so a
 * module with nothing special to do need not write it again. A module that needs a precondition or a
 * different error mapping calls `denyEvent` directly and keeps its own wrapper, which is cheaper to
 * read than an option would be.
 *
 * `fn` receives `(body, event)`: the body because almost every handler wants it, the event second
 * because a few need the sender and taking it away would make this unusable for them.
 */
function gate(cap, fn) {
  return async (event, body) => {
    const denied = denyEvent(event, cap);
    if (denied) return denied;
    try {
      return await fn(body || {}, event);
    } catch (err) {
      return { ok: false, error: err.message };
    }
  };
}

module.exports = { denyEvent, gate };
