'use strict';

/**
 * externalUrl.cjs — may this URL be handed to the operating system? (Section 196.3)
 *
 * WHY THIS IS ITS OWN MODULE. The decision used to be three lines inside the `shell:open-external`
 * handler, and a suite could only assert that the handler *contained* the right words. Mutation
 * testing then proved the point: replacing the parse with a prefix test left every textual check
 * passing. A judgement that matters has to be callable to be tested, so it moved out here — pure,
 * no `shell`, no `electron`, no I/O — and the handler became the one line that obeys it.
 *
 * This is the same shape as `vulnerabilityTriage.cjs` and `threatPosture.cjs`: the dangerous decision
 * is separated from the act, so the decision can be driven with hostile input and the act stays
 * trivial enough to read.
 *
 * WHAT IS REFUSED AND WHY:
 *
 *   anything but http/https   `file:` would open a local file, and the handler's whole job is to hand
 *                             something to another application. Worse are the schemes a platform
 *                             registers for itself — `ms-msdt:`, `search-ms:`, `vscode:` — any of
 *                             which turns "open a link" into "start a program with an argument".
 *                             An allowlist of two is the only defensible shape here.
 *   embedded credentials      `https://user:token@host` hands the credential to whatever opens it,
 *                             and it also hides the real host behind text that reads like one. Rāma
 *                             holds git tokens and broker keys, so a URL built from a template with
 *                             a credential in it is a plausible accident, not a theoretical one.
 *   a URL that will not parse  if `new URL` cannot agree what this is, neither can the OS handler,
 *                             and "we disagree about what this string means" is exactly when not to
 *                             pass it on.
 *
 * WHAT IS NOT CHECKED, deliberately: the host. There is no allowlist of domains, because this exists
 * so master can follow a link the app showed him — a documentation page, a broker login, a repository
 * — and a domain list would silently break the next one. The protection is that the OS browser opens
 * it in its own sandbox, not that we vetted the destination.
 */

/** Schemes that may be handed outward. Two, and adding a third should feel like a decision. */
const ALLOWED_PROTOCOLS = Object.freeze(['http:', 'https:']);

/**
 * @param {unknown} url
 * @returns {{ok:true, url:string} | {ok:false, error:string}}
 */
function judge(url) {
  if (typeof url !== 'string' || url.trim() === '') {
    return { ok: false, error: 'No URL was given' };
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: 'Not a valid URL' };
  }
  if (!ALLOWED_PROTOCOLS.includes(parsed.protocol)) {
    return { ok: false, error: `Blocked ${parsed.protocol} URL — only http and https are opened` };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, error: 'Blocked URL carrying credentials' };
  }
  // The PARSED form is returned, not the input. If the two differ, the parser's reading is the one
  // the OS should receive — passing the original back would mean validating one string and opening
  // another.
  return { ok: true, url: parsed.toString() };
}

module.exports = { judge, ALLOWED_PROTOCOLS };
