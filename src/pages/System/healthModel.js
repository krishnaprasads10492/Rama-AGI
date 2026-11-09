/**
 * healthModel.js — what the startup-diagnosis panel says, as data (spec Section 187)
 *
 * THE GAP THIS CLOSES. `health:startup` has been registered in `main.cjs` and exposed on
 * `window.rama.health` since Section 49, and **nothing in `src/` has ever called it**. The whole
 * diagnosis — fatal faults, degradations, the per-dependency check list, the previous run's crash,
 * the build manifest — went to `console.warn`, and a packaged app has no console. So everything
 * Sections 183.2 and 183.3 added was invisible on an installed instance, which is why master had to
 * photograph a build log to find out what his own app already knew.
 *
 * That makes this the third "registered and unreachable" surface in four tranches, after
 * `deps:review` with no handler (182.0) and `nativeModules` recorded and never read (183.3).
 *
 * THE FOUR RULES THIS FILE HOLDS
 *   - AN EXPECTED DEGRADATION IS NOT DAMAGE. `startupDoctor` marks a degradation `expected` when
 *     the build manifest recorded that it could not compile the module. Showing that beside a real
 *     fault, in the same colour, is how master ends up hunting a bug that does not exist.
 *   - NOTHING IS REPAIRED WITHOUT ASKING, and the repair's own limit is stated: a fetch cannot
 *     supply a compiler (Section 183.6), so a native module will never be fixed by this button and
 *     the panel says so before he presses it.
 *   - "HEALTHY" IS NOT CLAIMED FROM A DIAGNOSIS THAT DID NOT RUN. `ok: false` from the channel
 *     means the diagnosis is absent, which is a different thing from a clean one.
 *   - A MISSING FIGURE IS A DASH, and a count of zero is a zero. Same rule as `securityModel.js`.
 */

/** Severity classes in the order a reader should meet them. */
export const CLASSES = Object.freeze(['fatal', 'unexpected', 'expected', 'pass']);

const dash = (v) => (Number.isFinite(v) ? String(v) : '—');
const arr = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : []);

/**
 * Has the diagnosis run, and if not, why not.
 *
 * Three nothings, as in `securityModel.js`: not asked yet, the channel refused, and the diagnosis
 * itself has not run in the main process. The third is the one a bare empty state would hide.
 */
export function state(payload) {
  if (!payload) {
    return { kind: 'idle', title: 'Not read yet', detail: 'The startup diagnosis has not been requested.' };
  }
  if (payload.ok === false) {
    const why = payload.error ? String(payload.error) : 'No reason was reported.';
    // The main process answers exactly this when `diagnose()` has not completed.
    const notRun = /has not run yet/i.test(why);
    return {
      kind: notRun ? 'not-run' : 'failed',
      title: notRun ? 'The diagnosis has not run' : 'The diagnosis could not be read',
      detail: notRun
        ? `${why} It runs once at startup, so this is expected only very early in a launch.`
        : why,
    };
  }
  return { kind: 'ready', title: 'Diagnosed at startup', detail: null };
}

/**
 * The headline, which must distinguish "nothing wrong" from "nothing wrong that I can see".
 *
 * `healthy` from the main process means only that the FATAL list is empty. A build with no manifest
 * cannot tell an accepted trade-off from damage at all, and that limitation travels with the
 * verdict rather than being folded into it.
 */
export function headline(payload) {
  const d = (payload && payload.data) || {};
  const fatal = arr(d.fatal);
  const degraded = arr(d.degraded);
  const expected = degraded.filter((x) => x.expected === true);
  const unexpected = degraded.filter((x) => x.expected !== true);
  const checks = arr(d.checks);
  const manifest = d.buildManifest || null;

  return {
    fatal: fatal.length,
    unexpected: unexpected.length,
    expected: expected.length,
    checksRun: checks.length || null,
    checksPassed: checks.length ? checks.filter((c) => c.pass).length : null,
    packaged: typeof d.packaged === 'boolean' ? d.packaged : null,
    // DELIBERATELY NOT A BOOLEAN "healthy". `fatal.length === 0` is what the main process means by
    // it, and saying "healthy" would overstate a diagnosis that only looks at what it knows to look
    // at — the same refusal `securityModel.js` makes about a zero.
    verdict: fatal.length > 0
      ? 'faults that stop features working'
      : (unexpected.length > 0 ? 'degraded in ways this build did not expect' : 'no faults found'),
    // The sentence that stops a clean line being read as a guarantee.
    caveat: manifest
      ? 'This compares the running app against what the build recorded. A fault in something it '
        + 'does not check would not appear here.'
      : 'No build manifest shipped with this app, so a degradation cannot be told apart from an '
        + 'accepted build-time trade-off. Everything below reads as a fault whether it is one or not.',
    manifestPresent: !!manifest,
  };
}

/** The build's own record, so "known at build time" can be checked rather than trusted. */
export function build(payload) {
  const m = (payload && payload.data && payload.data.buildManifest) || null;
  if (!m) return null;
  const native = m.nativeModules || null;
  return {
    version: m.version || null,
    builtAt: m.builtAt ? String(m.builtAt).slice(0, 10) : null,
    builtOn: m.builtOn || null,
    nodeAtBuild: m.nodeAtBuild || null,
    verdict: (m.readiness && m.readiness.verdict) || null,
    // The block Section 178 recorded and Section 183.3 finally wired into the diagnosis.
    nativeRebuilt: native ? native.rebuilt : null,
    nativeDegraded: Array.isArray(native && native.degraded) ? native.degraded : [],
    nativeConsequences: Array.isArray(native && native.consequences) ? native.consequences : [],
  };
}

/**
 * Every finding as a row, worst first, each already classified.
 *
 * `expected` is a CLASS, not a flag to be rendered in the corner: the reader's first question about
 * a degradation is whether it is his problem, and the answer belongs in the same glance as the name.
 */
export function rows(payload, { limit = 50 } = {}) {
  const d = (payload && payload.data) || {};
  const out = [];
  for (const f of arr(d.fatal)) {
    out.push({
      id: f.id || f.module || 'unknown',
      cls: 'fatal',
      label: 'stops a feature working',
      detail: f.detail || 'No detail was reported.',
      remedy: f.remedy || null,
      module: f.module || null,
      expected: false,
    });
  }
  for (const f of arr(d.degraded)) {
    const expected = f.expected === true;
    out.push({
      id: f.id || f.module || 'unknown',
      cls: expected ? 'expected' : 'unexpected',
      label: expected ? 'known at build time, not a fault here' : 'degraded unexpectedly',
      detail: f.detail || 'No detail was reported.',
      remedy: f.remedy || null,
      module: f.module || null,
      expected,
      // Section 183.6: a module needing a compiler can never be fixed by fetching it, and the row
      // must say so where the repair button is in the same view.
      fetchable: f.fetchable === false ? false : null,
    });
  }
  const order = (c) => CLASSES.indexOf(c);
  return out.sort((a, b) => order(a.cls) - order(b.cls)).slice(0, Math.max(0, limit));
}

/** The per-dependency check list, for a reader who wants the detail rather than the summary. */
export function checks(payload) {
  return arr((payload && payload.data && payload.data.checks)).map((c) => ({
    label: c.label || '(unnamed)',
    pass: c.pass === true,
    // A note is the interesting half: "installed but its native binding was never built" is the
    // sentence Section 183.2 added, and it only reaches a reader through here.
    note: c.note ? String(c.note) : null,
  }));
}

/** The previous run's crash, which is the fault most likely to be forgotten. */
export function lastCrash(payload) {
  const c = (payload && payload.data && payload.data.previousCrash) || null;
  if (!c) return null;
  return {
    message: c.message || 'No message was recorded.',
    at: c.at || c.timestamp || null,
    // Said plainly: this is the PREVIOUS run, not this one, or a reader will go looking for a
    // problem that is currently not happening.
    note: 'This killed the previous launch. It is not necessarily still happening.',
  };
}

/**
 * What a repair pass can and cannot do, and what the last one did.
 *
 * THE LIMIT IS STATED BEFORE THE BUTTON, not after it fails. `repair()` fetches packages named in
 * the lockfile; a native module needs a C++ toolchain, so no amount of fetching will fix argon2 or
 * node-pty (Section 183.6). A button that silently cannot help with the thing a reader is looking
 * at is worse than no button.
 */
export function repair(payload) {
  const d = (payload && payload.data) || {};
  const last = d.repair || null;
  const unfixable = rows(payload).filter((r) => r.fetchable === false).map((r) => r.module || r.id);
  return {
    can: 'A repair fetches packages this build declares in its lockfile, verifies their checksums, '
      + 'and retries the loads that failed.',
    cannot: 'It cannot compile anything. A module that needs a C++ toolchain is out of its reach, '
      + 'however many times it runs.',
    unfixable,
    unfixableNote: unfixable.length
      ? `${unfixable.join(', ')} will not be fixed by this — ${unfixable.length === 1 ? 'it needs' : 'they need'} a compiler on the build machine.`
      : null,
    last: last && {
      attempted: Array.isArray(last.attempted) ? last.attempted : [],
      repaired: Array.isArray(last.repaired) ? last.repaired : [],
      recovered: Array.isArray(last.recovered) ? last.recovered : [],
      remaining: Array.isArray(last.remaining) ? last.remaining : [],
      notes: Array.isArray(last.notes) ? last.notes.map(String) : [],
    },
  };
}

/** Subsystems whose IPC never registered — a missing channel, named before it is met. */
export function unregistered(payload) {
  const list = (payload && payload.data && payload.data.registrationFailures) || [];
  return (Array.isArray(list) ? list : []).filter(Boolean).map((f) => ({
    label: f.label || f.name || 'unnamed subsystem',
    error: f.error || 'No reason was reported.',
  }));
}

/** A one-line summary for a collapsed card. Never the word healthy. */
export function oneLine(payload) {
  const s = state(payload);
  if (s.kind !== 'ready') return s.title;
  const h = headline(payload);
  const parts = [];
  if (h.fatal) parts.push(`${h.fatal} fault(s)`);
  if (h.unexpected) parts.push(`${h.unexpected} unexpected degradation(s)`);
  if (h.expected) parts.push(`${h.expected} known at build time`);
  if (parts.length === 0) {
    return `no faults found across ${dash(h.checksRun)} checks`;
  }
  return parts.join(' · ');
}
