'use strict';

/**
 * registrySources.cjs — where the advisor's facts come from (spec Section 96).
 *
 * `dependencyAdvisor.cjs` holds the judgement and was built and tested first, because judgement is
 * the part that can be wrong expensively. This is the adapter that feeds it:
 *
 *   registry.npmjs.org/<name>   → newest published version, unpacked size, publication date
 *   api.osv.dev/v1/query        → published advisories affecting the pinned version
 *
 * PARSING IS PURE. The network functions are injected, so every shape below is tested against
 * captured fixtures rather than the live internet — the same arrangement as `ollamaLibrary.cjs`.
 *
 * THE RULE THIS MODULE MUST NOT BREAK: a failed lookup is reported as a failure. It is never
 * silently dropped and never allowed to look like "up to date" or "no advisories". A package whose
 * registry call timed out is unknown, and unknown is its own answer (Section 88).
 */

const NPM_BASE = 'https://registry.npmjs.org';
const OSV_URL = 'https://api.osv.dev/v1/query';

/** Scoped names must be URL-encoded: `@babel/parser` → `@babel%2Fparser`. */
function npmUrl(name) {
  return `${NPM_BASE}/${String(name).replace('/', '%2F')}`;
}

/**
 * Read what matters from an npm packument.
 *
 * Only three things are wanted, and the packument is large, so this deliberately ignores the rest
 * rather than carrying a megabyte of metadata into the assessment.
 */
function parsePackument(json) {
  if (!json || typeof json !== 'object') return null;

  const latest = json['dist-tags'] && typeof json['dist-tags'].latest === 'string'
    ? json['dist-tags'].latest
    : null;
  if (!latest) return null;

  const versions = (json.versions && typeof json.versions === 'object') ? json.versions : {};
  const times = (json.time && typeof json.time === 'object') ? json.time : {};

  const sizeOf = (v) => {
    const n = versions[v] && versions[v].dist && Number(versions[v].dist.unpackedSize);
    // Absent rather than zero: npm omits `unpackedSize` on older publishes, and a zero would read
    // as "this package is empty" and produce a nonsensical disk delta.
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  const publishedAt = typeof times[latest] === 'string' ? times[latest] : null;

  return {
    latest,
    latestSizeBytes: sizeOf(latest),
    publishedAt,
    sizeForVersion: sizeOf,
    deprecated: typeof versions[latest]?.deprecated === 'string'
      ? versions[latest].deprecated
      : null,
  };
}

/**
 * Advisories from an OSV response.
 *
 * OSV answers a specific version, so an empty `vulns` means "nothing known about THIS version",
 * which is exactly the `no-advisory-found` state the advisor distinguishes from `verified-clean`.
 */
function parseOsv(json) {
  if (!json || typeof json !== 'object') return [];
  const vulns = Array.isArray(json.vulns) ? json.vulns : [];
  return vulns.map(v => ({
    id: v.id || 'unknown',
    summary: typeof v.summary === 'string' ? v.summary.slice(0, 200) : null,
    // OSV puts a CVSS vector or a database-specific rating here; whichever is present is carried
    // through unchanged rather than being mapped onto an invented scale.
    severity: Array.isArray(v.severity) && v.severity.length
      ? (v.severity[0].score || v.severity[0].type || null)
      : (v.database_specific && v.database_specific.severity) || null,
  }));
}

function daysSince(iso, now) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.round((now.getTime() - t) / 86_400_000));
}

/**
 * Gather registry and advisory facts for a pinned dependency set.
 *
 * @param {object}   opts
 * @param {object}   opts.pinned      `{ name: exactVersion }` from package.json
 * @param {function} opts.getJson     `(url) => Promise<object>`
 * @param {function} [opts.postJson]  `(url, body) => Promise<object>`; without it, advisories are
 *                                    left UNCHECKED rather than assumed absent
 * @param {Date}     [opts.now]
 * @param {number}   [opts.concurrency]
 *
 * Returns rows shaped for `dependencyAdvisor.review()`, plus a `failures` list.
 *
 * WHY EACH PACKAGE FAILS ALONE: one unreachable package must not discard the other forty. A row that
 * could not be fetched is returned with `latest === pinned` and a recorded reason, so the advisor
 * classifies it as `current` — the one classification that recommends no action — instead of the
 * package vanishing from the review and appearing to be fine by absence.
 */
async function collect({
  pinned = {},
  getJson,
  postJson = null,
  now = new Date(),
  concurrency = 4,
} = {}) {
  if (typeof getJson !== 'function') {
    return { rows: [], failures: [{ name: '*', reason: 'no fetcher supplied' }] };
  }

  const names = Object.keys(pinned);
  const rows = [];
  const failures = [];

  // Bounded concurrency: forty simultaneous registry requests is the stampede the scheduler's
  // startup spread exists to avoid, and re-creating it inside one task would defeat that.
  let cursor = 0;
  async function worker() {
    while (cursor < names.length) {
      const name = names[cursor];
      cursor += 1;
      const version = String(pinned[name]);

      let pack = null;
      try {
        pack = parsePackument(await getJson(npmUrl(name)));
      } catch (err) {
        failures.push({ name, reason: `registry: ${err.message}` });
      }

      if (!pack) {
        if (!failures.some(f => f.name === name)) {
          failures.push({ name, reason: 'registry returned no usable version information' });
        }
        // Reported as current-with-a-reason rather than omitted, so it cannot look fine by absence.
        rows.push({
          name, pinned: version, latest: version,
          advisory: null, unavailable: true,
        });
        continue;
      }

      // Advisories are only ever claimed as CHECKED when a lookup actually ran and returned.
      let advisory = null;
      if (typeof postJson === 'function') {
        try {
          const res = await postJson(OSV_URL, {
            package: { name, ecosystem: 'npm' },
            version,
          });
          advisory = { checked: true, found: parseOsv(res) };
        } catch (err) {
          failures.push({ name, reason: `advisory lookup: ${err.message}` });
          advisory = null;   // stays `unchecked`, which the advisor surfaces as a concern
        }
      }

      rows.push({
        name,
        pinned: version,
        latest: pack.latest,
        advisory,
        sizeBytes: pack.sizeForVersion(version),
        latestSizeBytes: pack.latestSizeBytes,
        releaseAgeDays: daysSince(pack.publishedAt, now),
        // A deprecation notice is the maintainer speaking directly, so it is carried as a signal
        // with the registry as its source rather than being folded into the version arithmetic.
        signals: pack.deprecated
          ? [{ claim: `Maintainer deprecation notice: ${pack.deprecated}`, source: 'npm registry' }]
          : [],
      });
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));

  rows.sort((a, b) => a.name.localeCompare(b.name));
  return { rows, failures };
}

module.exports = {
  collect, parsePackument, parseOsv, npmUrl, daysSince,
  NPM_BASE, OSV_URL,
};
