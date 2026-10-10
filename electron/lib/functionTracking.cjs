'use strict';

/**
 * functionTracking.cjs — what a module actually did, when, and over which data (spec Section 138).
 *
 * Master asked for a record that can answer "what was the impact, at any point in time, for any
 * module", so that backtesting and the rest can be VALIDATED rather than taken on trust.
 *
 * WHY THIS IS A dataStore DOMAIN AND NOT A NEW DATABASE. I14 says a passcode change is a FULL
 * re-key: load under the old keys, destroy the salt, re-derive, rewrite everything. The mechanism is
 * `dataStore.markAllDirty()`, which iterates `DOMAINS`. **A store living outside `dataStore` is not
 * re-keyed and silently becomes the one unreadable island after master changes his passcode.** So
 * tracking is a domain — it inherits encryption, the autosave and the re-key BY CONSTRUCTION, and
 * `dataStore.push()` already stamps `_id` and `_ts`, which is the append primitive this needs.
 *
 * WHAT A RECORD IS, AND WHAT IT IS NOT. It is a MEASUREMENT: where, when, how long, what outcome,
 * and which data window was read. **It is never an inferred impact.** "Module X caused outcome Y" is
 * a causal claim and nothing here is entitled to make one — `claimGate.cjs` fixes that vocabulary
 * and this module stays inside it. A reader can correlate records; the records do not conclude.
 *
 * WHY IT IS BOUNDED, and why that is not a limitation to apologise for. Master's standing
 * requirement is capability "without losing speed & optimization". An unbounded per-call log is a
 * memory leak that grows fastest exactly when the app is busiest, and encrypting an ever-larger
 * domain makes every autosave slower. So the ring is capped at `CAP` and the OLDEST record is
 * dropped first, which is the right direction: the recent past is what validates a run.
 *
 * IT FAILS OPEN, DELIBERATELY. `record()` swallows its own errors and returns false rather than
 * throwing. Tracking is not a security gate — nothing is authorised by it — so a broken recorder
 * must never break the computation it was only watching. Every other gate in this codebase fails
 * CLOSED; this one is the deliberate exception and the asymmetry is the point.
 *
 * THE BACKTEST CASE, which is why master asked. A backtest record carries its `window` — the data
 * range it read — and its `sample` size. That is what makes Section 135's rule auditable later: a
 * result whose window overlaps the data used to choose the strategy is IN-SAMPLE, and without the
 * window recorded at the time nobody can tell afterwards. The gate still lives in Section 135; this
 * is the evidence it will be judged on.
 */

const DOMAIN = 'tracking';
const ARRAY_KEY = 'calls';

/** The ring's ceiling. Oldest dropped first. */
const CAP = 2000;

/** The only outcomes a record may carry. A free-text outcome is how a log becomes unqueryable. */
const OUTCOMES = Object.freeze(['ok', 'refused', 'error', 'skipped']);

const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : '');

/**
 * Normalise a caller's record into the stored shape, or return null when it is not usable.
 *
 * Exported so the suite can exercise the rules without a store behind it, and so a caller can check
 * a record before paying for a write.
 *
 * @param {{module?: string, fn?: string, ms?: number, outcome?: string, detail?: string,
 *   window?: {from?: string|number, to?: string|number}, sample?: number}} r
 * @returns {object|null}
 */
function normalise(r) {
  const o = (r && typeof r === 'object' && !Array.isArray(r)) ? r : null;
  if (!o) return null;

  const mod = text(o.module);
  const fn = text(o.fn);
  // WITHOUT BOTH, A RECORD CANNOT ANSWER "for any module" — which is the whole request.
  if (!mod || !fn) return null;

  const outcome = OUTCOMES.includes(o.outcome) ? o.outcome : null;
  if (!outcome) return null;

  const out = { module: mod, fn, outcome };

  // A duration is optional but, when present, must be a real non-negative number. A negative
  // duration is a clock problem, not a measurement, and storing it would corrupt any later median.
  if (o.ms !== undefined && o.ms !== null) {
    if (!finite(o.ms) || o.ms < 0) return null;
    out.ms = o.ms;
  }
  const detail = text(o.detail);
  if (detail) out.detail = detail.slice(0, 300);

  // THE DATA WINDOW IS THE AUDITABLE PART. Kept verbatim as given, because reinterpreting a caller's
  // range is how an in-sample run later reads as out-of-sample.
  if (o.window && typeof o.window === 'object') {
    const from = o.window.from;
    const to = o.window.to;
    if (from !== undefined || to !== undefined) {
      out.window = {};
      if (from !== undefined) out.window.from = from;
      if (to !== undefined) out.window.to = to;
    }
  }
  if (o.sample !== undefined && o.sample !== null) {
    if (!finite(o.sample) || o.sample < 0) return null;
    out.sample = Math.floor(o.sample);
  }
  return out;
}

/**
 * Append one measurement. Never throws, never blocks on anything but an in-memory push.
 *
 * @param {object} store the `dataStore` module, injected so the suite runs without Electron
 * @param {object} rec
 * @returns {boolean} whether it was recorded — false is a refusal or a swallowed failure, and the
 *   caller is expected to carry on either way
 */
function record(store, rec) {
  try {
    const row = normalise(rec);
    if (!row) return false;
    if (!store || typeof store.push !== 'function' || typeof store.get !== 'function') return false;
    store.push(DOMAIN, ARRAY_KEY, row);
    prune(store);
    return true;
  } catch {
    // FAIL OPEN. A recorder that throws would take down the computation it was watching.
    return false;
  }
}

/** Drop the oldest rows once the ring is over `CAP`. Returns how many were dropped. */
function prune(store) {
  try {
    const bag = store.get(DOMAIN) || {};
    const rows = Array.isArray(bag[ARRAY_KEY]) ? bag[ARRAY_KEY] : [];
    if (rows.length <= CAP) return 0;
    const dropped = rows.length - CAP;
    // `_ts` is stamped by dataStore.push, so "oldest" is a measured field and not insertion luck.
    rows.sort((a, b) => Number(a?._ts || 0) - Number(b?._ts || 0));
    store.set(DOMAIN, ARRAY_KEY, rows.slice(dropped));
    return dropped;
  } catch {
    return 0;
  }
}

/**
 * Read the record back — "at any point of time and for any module".
 *
 * @param {object} store
 * @param {{module?: string, fn?: string, from?: number, to?: number, outcome?: string,
 *   limit?: number}} [q] `from`/`to` are epoch ms against the stamped `_ts`
 * @returns {Array<object>} newest first, never a reference to the stored array
 */
function query(store, q) {
  try {
    if (!store || typeof store.get !== 'function') return [];
    const bag = store.get(DOMAIN) || {};
    const rows = Array.isArray(bag[ARRAY_KEY]) ? bag[ARRAY_KEY] : [];
    const f = (q && typeof q === 'object') ? q : {};
    const mod = text(f.module);
    const fn = text(f.fn);
    const outcome = OUTCOMES.includes(f.outcome) ? f.outcome : null;
    const from = finite(f.from) ? f.from : null;
    const to = finite(f.to) ? f.to : null;
    const limit = finite(f.limit) && f.limit > 0 ? Math.floor(f.limit) : 500;

    const hit = rows.filter((r) => {
      if (!r || typeof r !== 'object') return false;
      if (mod && r.module !== mod) return false;
      if (fn && r.fn !== fn) return false;
      if (outcome && r.outcome !== outcome) return false;
      const ts = Number(r._ts || 0);
      if (from !== null && ts < from) return false;
      if (to !== null && ts > to) return false;
      return true;
    });
    // A COPY, so a caller cannot mutate the store by editing what it read.
    return hit
      .sort((a, b) => Number(b._ts || 0) - Number(a._ts || 0))
      .slice(0, limit)
      .map((r) => ({ ...r }));
  } catch {
    return [];
  }
}

/**
 * What the record SAYS, with no causal claim attached.
 *
 * Deliberately returns counts and a median rather than a verdict: "slow" and "degraded" are
 * judgements, and a summary that makes them invites the reader to treat correlation as cause. The
 * numbers are measurements; the reading is master's.
 */
function summarise(store, q) {
  const rows = query(store, { ...(q || {}), limit: CAP });
  const durations = rows.filter((r) => finite(r.ms)).map((r) => r.ms).sort((a, b) => a - b);
  const byOutcome = {};
  for (const o of OUTCOMES) byOutcome[o] = 0;
  for (const r of rows) if (byOutcome[r.outcome] !== undefined) byOutcome[r.outcome] += 1;
  const median = durations.length === 0 ? null
    : (durations.length % 2 === 1
      ? durations[(durations.length - 1) / 2]
      : (durations[durations.length / 2 - 1] + durations[durations.length / 2]) / 2);
  return {
    records: rows.length,
    byOutcome,
    medianMs: median,
    timed: durations.length,
    // STATED, so a reader never mistakes a partial window for the whole history.
    note: rows.length >= CAP
      ? `at the ${CAP}-record ceiling, so older calls have been dropped and this is not the whole history`
      : 'every record held for this filter is counted',
  };
}

module.exports = {
  DOMAIN, ARRAY_KEY, CAP, OUTCOMES,
  normalise, record, prune, query, summarise,
};
