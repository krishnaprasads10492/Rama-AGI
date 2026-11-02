'use strict';

/**
 * fieldEvidence.cjs - what only the machine running Rāma can tell us (spec Section 171)
 *
 * THE GAP THIS EXISTS FOR. Twenty-odd ledger rows say the same thing: built, verified against fakes,
 * never run against the real thing. None of them is blocked on code. They are blocked on an
 * observation from the machine where the app actually runs - one with a vault, a broker account, a
 * renderer that renders, and `node_modules` installed. No test written here can close any of them.
 *
 * OFF UNLESS MASTER TURNS IT ON. A component that collects facts about master's machine and can
 * send them elsewhere is telemetry, and telemetry nobody switched on is telemetry nobody consented
 * to. Default `off`; an unreadable or unrecognised flag resolves to `off`, never to something
 * permissive (171.4 D2).
 *
 * RECORDING AND SENDING ARE DIFFERENT PERMISSIONS. `local` writes a report master can read.
 * `ship` lets it travel. One switch for both would mean the only way to get a local diagnostic is
 * to consent to publication.
 *
 * IT OBSERVES, IT NEVER EXERCISES (171.2). The shortcut this refuses is having it produce its own
 * evidence - log into the broker, push to GitHub, unlock the vault, report what happened. That is a
 * diagnostic performing authenticated actions with master's credentials, unattended, to generate
 * its own results. Evidence comes from runs master performed or artefacts already on disk.
 *
 * PURE, like `threatPosture.cjs` and for the same reason. No `require`, no filesystem, no network,
 * no `child_process`. There is one main-process HTTP client (I9) and this is emphatically not it.
 * `scripts/verifyFieldEvidence.cjs` holds that shut structurally rather than by promise.
 */

// ─── The flag ────────────────────────────────────────────────────────────────────────────────────
/** `off` records nothing. `local` writes a report to disk. `ship` additionally lets it travel. */
const MODES = Object.freeze(['off', 'local', 'ship']);

/**
 * Resolve the mode, failing closed.
 *
 * The environment wins over stored config so the BUILD MACHINE can be asked for a report: it runs
 * `npm run` scripts with no UI session, so a datastore setting is unreachable there. An env value
 * that is present but unrecognised resolves to `off` rather than falling through to config -
 * otherwise a typo in the environment silently hands the decision to something else.
 *
 * @param {{env?:unknown, config?:unknown}} sources
 * @returns {'off'|'local'|'ship'}
 */
function readMode(sources = {}) {
  const env = sources ? sources.env : undefined;
  const envGiven = typeof env === 'string' && env.trim() !== '';
  const raw = envGiven ? env : (sources ? sources.config : undefined);
  if (typeof raw !== 'string') return 'off';
  const v = raw.trim().toLowerCase();
  return MODES.includes(v) ? v : 'off';
}

const isOn = (mode) => mode === 'local' || mode === 'ship';
const maySend = (mode) => mode === 'ship';

// ─── The three states, and the distinction the whole design turns on ─────────────────────────────
/**
 * `observed`       a real run of the real path recorded that it happened
 * `inspected`      an artefact on disk implies it, read just now
 * `refuted`        it was looked at and the claim does NOT hold
 * `never-observed` nothing has been seen, and that is what gets reported
 *
 * `inspected` is NEVER promoted to `observed`, and `never-observed` is NEVER rendered as a pass.
 * This is Section 170's D4 in a second setting: "I have not seen it" and "it works" are different
 * facts, and a report that blurs them tells master the opposite of what he needs (171.3).
 *
 * `refuted` was added while building this, because the first version had no way to say "I looked,
 * and it is not true". A Node version below the floor would have been recorded as `never-observed`
 * - indistinguishable from never having looked - which is the same blur in a third costume. A
 * refutation is the most actionable thing this report can carry, so it leads the output.
 */
const STATES = Object.freeze(['never-observed', 'refuted', 'inspected', 'observed']);
const RECORDABLE = Object.freeze(['refuted', 'inspected', 'observed']);

// ─── The claim registry ──────────────────────────────────────────────────────────────────────────
/**
 * One entry per ledger row that is blocked on a real-machine observation. A claim with no `row` is
 * a claim nobody asked for (171.4 D8).
 *
 * `bar` is the weakest state that actually closes the row. Where it is `observed`, no amount of
 * disk inspection closes it - the path has to run - and the report says so rather than pretending.
 */
const CLAIMS = Object.freeze([
  // ── readable from an artefact on the running machine ──
  { id: 'node-floor', row: 193, bar: 'inspected', title: 'the runtime on the build machine meets the declared Node floor' },
  { id: 'renderer-built', row: 29, bar: 'inspected', title: 'the renderer really builds, and produced output' },
  { id: 'data-outside-install', row: 185, bar: 'inspected', title: 'the data directory sits outside the install directory' },
  { id: 'vault-kdf', row: 189, bar: 'inspected', title: "master's own vault records which KDF sealed it" },
  { id: 'engine-python', row: 79, bar: 'inspected', title: 'the Python engine resolves on the machine that runs it' },
  { id: 'archiver-present', row: 69, bar: 'inspected', title: 'an archiver the installer can actually use is present' },

  // ── closable only by a real run; disk inspection cannot substitute ──
  // `packaged-install` and `token-expiry-recorded` sit here rather than above DELIBERATELY: a
  // script reading the repo cannot tell whether the app ran packaged, and the token's expiry lives
  // inside the encrypted store, which nothing may open to satisfy a report.
  { id: 'packaged-install', row: 185, bar: 'observed', title: 'Rāma is running from a packaged install rather than a checkout' },
  { id: 'token-expiry-recorded', row: 188, bar: 'observed', title: 'an expiry is recorded alongside the stored GitHub token' },
  { id: 'session-unlock', row: 79, bar: 'observed', title: "session:unlock was handled, with no \"no handler registered\" error" },
  { id: 'kite-session', row: 186, bar: 'observed', title: 'a real Kite session was established' },
  { id: 'kite-candles', row: 186, bar: 'observed', title: 'real historical candles arrived from Kite' },
  { id: 'git-push-ui', row: 187, bar: 'observed', title: 'a push succeeded using the credential entered in the UI' },
  { id: 'token-expiry-banner', row: 188, bar: 'observed', title: 'the token expiry banner was shown at login' },
  { id: 'strategy-book-screen', row: 181, bar: 'observed', title: 'the strategy book route rendered on screen' },
  { id: 'broker-accounts-screen', row: 182, bar: 'observed', title: 'the broker accounts screen rendered on screen' },
  { id: 'installer-built', row: 192, bar: 'observed', title: 'a real packaging run reached its readiness verdict' },
]);

const CLAIM_IDS = Object.freeze(CLAIMS.map((c) => c.id));
const claimOf = (id) => CLAIMS.find((c) => c.id === id) || null;

// ─── Shapes and counts, never values ────────────────────────────────────────────────────────────
/**
 * Keep only what cannot be a secret: finite numbers, booleans, and short identifier-shaped strings.
 * Everything else is DROPPED and counted, so the report can say how much it withheld instead of
 * quietly carrying it (171.4 D5).
 *
 * Structural rather than advisory. A caller that hands over a token, a price, a path or a nested
 * object cannot get it into a report through here, however the call site is later edited.
 *
 * @returns {{detail:object, dropped:string[]}}
 */
function shapeOnly(raw) {
  const detail = {};
  const dropped = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { detail, dropped };
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === 'boolean') { detail[k] = v; continue; }
    if (typeof v === 'number') { if (Number.isFinite(v)) detail[k] = v; else dropped.push(k); continue; }
    if (typeof v === 'string') {
      const s = v.trim();
      const identifierShaped = /^[A-Za-z0-9._:+-]{1,24}$/.test(s);
      const looksLikeHex = /^[A-Fa-f0-9]{16,}$/.test(s);
      const looksLikeToken = /^[A-Za-z0-9+/=_-]{20,}$/.test(s);
      if (identifierShaped && !looksLikeHex && !looksLikeToken) detail[k] = s;
      else dropped.push(k);
      continue;
    }
    dropped.push(k);
  }
  return { detail, dropped };
}

// ─── Recording ───────────────────────────────────────────────────────────────────────────────────
/**
 * Add an observation, returning a NEW ledger. Immutable so a caller cannot be handed a reference
 * and quietly rewrite history through it.
 *
 * Refused, each costing nothing but returning the ledger unchanged: an unknown claim id (a claim
 * must be declared next to the row it closes), a state that is not `inspected` or `observed`
 * (`never-observed` is the ABSENCE of a record, so recording it is meaningless and would let a
 * caller overwrite a real observation with nothing), and any call at all while the mode is `off`.
 *
 * @param {object} ledger existing records, keyed by claim id
 * @param {{id:string, state:string, at?:string, detail?:object}} entry
 * @param {'off'|'local'|'ship'} mode
 * @returns {{ledger:object, accepted:boolean, reason:string|null}}
 */
function record(ledger = {}, entry = {}, mode = 'off') {
  const base = (ledger && typeof ledger === 'object' && !Array.isArray(ledger)) ? ledger : {};
  const refuse = (reason) => ({ ledger: base, accepted: false, reason });

  if (!isOn(mode)) return refuse('field evidence is off');
  if (!entry || typeof entry !== 'object') return refuse('no entry');
  if (!claimOf(entry.id)) return refuse(`unknown claim: ${String(entry.id)}`);
  if (!RECORDABLE.includes(entry.state)) return refuse(`a record may only be ${RECORDABLE.join(' or ')}`);

  const { detail, dropped } = shapeOnly(entry.detail);
  const at = typeof entry.at === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(entry.at) ? entry.at : null;
  const next = { ...base, [entry.id]: { state: entry.state, at, detail, withheld: dropped.length } };
  return { ledger: next, accepted: true, reason: null };
}

// ─── The verdict ─────────────────────────────────────────────────────────────────────────────────
/**
 * Judge every declared claim against what has been recorded.
 *
 * A claim with no record is `never-observed`. A record whose state is not recognised is treated as
 * no record at all, because an unreadable record is not evidence. `closes` is true only when the
 * recorded state meets the claim's own bar, so an `inspected` artefact never closes a row that
 * needs a real run.
 *
 * @param {object} ledger
 * @param {ReadonlyArray<object>} claims
 * @returns {{rows:Array, summary:object}}
 */
function assess(ledger = {}, claims = CLAIMS) {
  const store = (ledger && typeof ledger === 'object' && !Array.isArray(ledger)) ? ledger : {};
  const rows = claims.map((c) => {
    const rec = store[c.id];
    const recorded = rec && STATES.includes(rec.state) && rec.state !== 'never-observed' ? rec.state : 'never-observed';
    return {
      id: c.id,
      row: c.row,
      title: c.title,
      bar: c.bar,
      state: recorded,
      // The row is closed only when what we have meets what the row needs. An `inspected` artefact
      // standing in for an `observed` run is exactly the promotion 171.3 forbids.
      closes: recorded === c.bar || (recorded === 'observed' && c.bar === 'inspected'),
      at: rec && typeof rec.at === 'string' ? rec.at : null,
      detail: rec && rec.detail && typeof rec.detail === 'object' ? rec.detail : {},
      withheld: rec && Number.isFinite(rec.withheld) ? rec.withheld : 0,
    };
  });
  const count = (s) => rows.filter((r) => r.state === s).length;
  return {
    rows,
    summary: {
      claims: rows.length,
      observed: count('observed'),
      inspected: count('inspected'),
      refuted: count('refuted'),
      neverObserved: count('never-observed'),
      closed: rows.filter((r) => r.closes).length,
      open: rows.filter((r) => !r.closes).length,
    },
  };
}

// ─── The report ──────────────────────────────────────────────────────────────────────────────────
/**
 * Lines for a terminal or a file. Leads with what is NOT known, because that is the actionable
 * half: this report's job is to turn twenty hand-written ledger notes into a precise list of what
 * the running machine must still be made to do.
 */
function lines(assessment, mode = 'off') {
  const { rows, summary } = assessment;
  const out = [
    'FIELD EVIDENCE - what this machine can and cannot confirm',
    `  mode: ${mode}   claims: ${summary.claims}   closed: ${summary.closed}   still open: ${summary.open}`,
    `  observed ${summary.observed}  ·  inspected ${summary.inspected}  ·  refuted ${summary.refuted}  ·  never observed ${summary.neverObserved}`,
    '',
  ];
  // Refutations lead, because they are the only group that is a finding rather than a gap.
  const refuted = rows.filter((r) => r.state === 'refuted');
  if (refuted.length) {
    out.push(`CONTRADICTED (${refuted.length}) - this machine was looked at and these are NOT true`);
    for (const r of refuted) {
      const d = Object.entries(r.detail).map(([k, v]) => `${k}=${v}`).join(' ');
      out.push(`  [!] ${r.title} (row ${r.row})${d ? ` · ${d}` : ''}`);
    }
    out.push('');
  }
  const open = rows.filter((r) => !r.closes && r.state !== 'refuted');
  if (open.length) {
    out.push(`STILL OPEN (${open.length}) - nothing here is a failure; it is work the running machine has not done yet`);
    for (const r of open) {
      const why = r.state === 'never-observed'
        ? `never observed; needs a real ${r.bar === 'observed' ? 'run' : 'artefact'}`
        : `only ${r.state}, and row ${r.row} needs ${r.bar}`;
      out.push(`  [ ] ${r.title} (row ${r.row}) - ${why}`);
    }
    out.push('');
  }
  const closed = rows.filter((r) => r.closes);
  if (closed.length) {
    out.push(`CONFIRMED (${closed.length})`);
    for (const r of closed) {
      const d = Object.entries(r.detail).map(([k, v]) => `${k}=${v}`).join(' ');
      out.push(`  [x] ${r.title} (row ${r.row}) - ${r.state}${r.at ? ` at ${r.at}` : ''}${d ? ` · ${d}` : ''}`);
    }
    out.push('');
  }
  const withheld = rows.reduce((n, r) => n + r.withheld, 0);
  if (withheld > 0) out.push(`  ${withheld} field(s) were withheld as not shape-only, rather than carried into this report.`);
  if (!maySend(mode)) out.push('  This report stays on this machine: the mode is not `ship`.');
  return out;
}

module.exports = { readMode, isOn, maySend, record, assess, lines, shapeOnly, claimOf, MODES, STATES, RECORDABLE, CLAIMS, CLAIM_IDS };
