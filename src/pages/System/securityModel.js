/**
 * securityModel.js — what the dependency-security panel says, as data (spec Section 182)
 *
 * The panel is mostly sentences about master's own exposure, and a sentence that overclaims here is
 * worse than silence: Section 180.5 found the manifest scan reporting "0 vulnerable" on a tree that
 * held twenty advisories, and the only reason that was not shipped to a screen is that the screen
 * did not exist yet. So every sentence the panel can say is made HERE, from the payload, in plain
 * functions `scripts/verifyUiSecurity.mjs` can drive with awkward input. The component lays them out.
 *
 * THE RULES THIS FILE HOLDS
 *   - A ZERO IS NEVER "CLEAN". `deps:review` returns two scans that answer different questions: the
 *     manifest scan asks about 24 direct dependencies, the tree scan asks about 638 installed
 *     packages. A zero from the narrower one means "not found among the names I asked about", and
 *     the panel must say which question was answered.
 *   - A DISAGREEMENT BETWEEN THE TWO SOURCES IS A FINDING, not something to average. When OSV says
 *     nothing and the tree says twenty, that gap is the most informative thing on the screen.
 *   - NOTHING IS APPLIED FROM HERE. I12 pins deliberately and Section 168.2 settled that
 *     "auto-check" means auto-REPORT. Every row carries a remedy as prose for master to perform.
 *   - NO SCORE, NO GRADE, NO PERCENTAGE OF SAFETY (claimGate). Counts and routes only.
 *   - A missing figure is a dash, never zero.
 */

/** The routes the triage can return, in the order a reader should meet them. */
export const ROUTE_LABELS = Object.freeze({
  'downgrade-refused': 'npm suggested a DOWNGRADE — refused',
  'no-fix-published': 'no fix published yet',
  'major-required': 'needs a breaking upgrade — your decision',
  'override-candidate': 'fixable by pinning it directly',
  'semver-fix': 'fixable within the declared ranges',
  unknown: 'not enough information to route',
});

/** Severity order for display. `unknown` sorts with the least urgent, never silently as low. */
export const SEVERITY_ORDER = Object.freeze(['critical', 'high', 'moderate', 'low', 'info', 'unknown']);

const dash = (v) => (Number.isFinite(v) ? String(v) : '—');

/**
 * Is there anything to show at all, and if not, WHY not.
 *
 * Four different nothings, and conflating them is the failure this file exists to prevent: the scan
 * has not run, the scan failed, the detail is withheld by policy, and the scan ran and found
 * nothing among the names it asked about.
 */
export function state(payload) {
  if (!payload) return { kind: 'idle', title: 'Not scanned yet', detail: 'Run a scan to see what the installed tree contains.' };
  if (payload.ok === false) {
    return { kind: 'failed', title: 'The scan could not complete',
      detail: payload.error ? String(payload.error) : 'No reason was reported.' };
  }
  const d = payload.data || {};
  const tree = d.tree || null;
  // A WITHHOLDING IS NOT A FAILURE. Below tier 0 the handler does not run the tree scan at all
  // (Section 182.0), and rendering that as "the scan did not run" would read as a broken subsystem
  // rather than a permission — the Section 107 mistake, which cost four panels reading as
  // "Rāma has done nothing" when the truth was "this account may not look".
  if (tree && tree.withheld === true) {
    // The reason from the handler is USED but not RELIED ON. Two things must reach the reader
    // whatever prose arrives: which capability would lift the withholding, and that the summary is
    // still real. Leaving either to the handler's wording means a terser message silently drops the
    // part that stops a reader concluding the panel is empty.
    const given = typeof tree.reason === 'string' && tree.reason ? tree.reason : null;
    const parts = [given || 'This account may not see the package-by-package detail.'];
    if (tree.requires && !(given && given.includes(tree.requires))) {
      parts.push(`It requires ${tree.requires}.`);
    }
    if (!(given && /not withheld/i.test(given))) {
      parts.push('The summary and coverage above are not withheld.');
    }
    return { kind: 'withheld', title: 'The detail is master-only', detail: parts.join(' ') };
  }
  if (tree && tree.ok === false) {
    return { kind: 'partial', title: 'Only the narrow scan completed',
      detail: `The tree-wide scan did not run: ${tree.reason || 'no reason given'}. `
        + 'What is shown below covers direct dependencies only.' };
  }
  return { kind: 'ready', title: 'Scanned', detail: null };
}

/**
 * The headline, which must never read as a clean bill of health.
 *
 * Deliberately NOT a single number. The two scans are reported side by side with the question each
 * answered, because one of them cannot see transitive packages and saying so is the whole point.
 */
export function headline(payload) {
  const d = (payload && payload.data) || {};
  const tree = d.tree && d.tree.ok ? d.tree : null;
  const narrow = {
    found: Number.isFinite(d.summary?.vulnerable) ? d.summary.vulnerable : null,
    asked: d.coverage?.directDependencies ?? null,
    question: 'direct dependencies, asked of OSV one package at a time',
  };
  const wide = {
    // `Array.isArray` rather than a truthiness check: a tree marked `ok` whose findings are null is
    // a malformed answer, and reading a count off it threw. Absent is reported as absent — a
    // malformed payload must not become the number 0, which is the one value that reads as good
    // news (found by `verifyUiSecurity.mjs` driving fourteen malformed payloads).
    found: tree && Array.isArray(tree.findings) ? tree.findings.length : null,
    asked: tree?.coverage?.treeTotals?.total ?? null,
    question: 'every installed package, via npm audit',
  };
  const disagree = narrow.found !== null && wide.found !== null && narrow.found !== wide.found;
  return {
    narrow,
    wide,
    // THE MOST USEFUL SENTENCE ON THE SCREEN when it fires.
    disagreement: disagree
      ? `The two scans disagree: ${narrow.found} against ${wide.found}. That is expected rather `
        + 'than broken — the narrow scan asks about names in package.json and answers per package, '
        + 'so a vulnerability inside a dependency of a dependency is outside its question. Trust '
        + 'the wider number.'
      : null,
    // No boolean "safe". There is no honest value for one.
    caveat: 'An advisory database knowing nothing about a package is not the same as that package '
      + 'being safe.',
  };
}

/** Counts by route, in reading order, with zero rows kept so the shape is stable. */
export function byRoute(payload) {
  const tree = payload?.data?.tree;
  const counts = (tree && tree.ok && tree.summary && tree.summary.byRoute) || null;
  return Object.keys(ROUTE_LABELS).map((route) => ({
    route,
    label: ROUTE_LABELS[route],
    count: counts && Number.isFinite(counts[route]) ? counts[route] : null,
    display: counts && Number.isFinite(counts[route]) ? String(counts[route]) : '—',
  }));
}

/**
 * The rows the panel lists, worst first, each already a sentence.
 *
 * `scopeNote` is carried through rather than folded into the severity: a critical that only runs on
 * the build machine is still a critical, and hiding that distinction in a number would be the
 * flattering error.
 */
export function rows(payload, { limit = 50 } = {}) {
  const tree = payload?.data?.tree;
  if (!tree || tree.ok !== true || !Array.isArray(tree.findings)) return [];
  const order = (s) => {
    const i = SEVERITY_ORDER.indexOf(String(s || 'unknown').toLowerCase());
    return i < 0 ? SEVERITY_ORDER.length : i;
  };
  return tree.findings
    // A null entry inside an otherwise good list threw in the comparator, taking the whole panel
    // down for one bad element. Dropped rather than rendered as a blank row.
    .filter((f) => f && typeof f === 'object')
    .sort((a, b) => order(a.severity) - order(b.severity))
    .slice(0, Math.max(0, limit))
    .map((f) => ({
      name: f.name,
      severity: String(f.severity || 'unknown').toLowerCase(),
      route: f.route,
      routeLabel: ROUTE_LABELS[f.route] || f.route,
      // "via vectra" is the part that makes a transitive finding actionable.
      reachedThrough: f.reachedThrough || null,
      via: f.reachedThrough ? `reached through ${f.reachedThrough}` : null,
      why: f.why || null,
      remedy: f.remedy || null,
      scopeNote: f.scopeNote || null,
      // A finding master can act on today, versus one that is his decision, versus neither.
      actionable: f.route === 'semver-fix' || f.route === 'override-candidate',
      needsDecision: f.route === 'major-required' || f.route === 'downgrade-refused',
      advisories: Array.isArray(f.advisories) ? f.advisories.filter((a) => a && a.title) : [],
    }));
}

/** What the scan did NOT look at, phrased for a reader rather than a log. */
export function limits(payload) {
  const d = (payload && payload.data) || {};
  const out = [];
  const narrow = d.coverage;
  if (narrow && narrow.installedTreeCovered === false) {
    out.push('The OSV pass covers direct dependencies only, and answers per package rather than '
      + 'per dependency chain.');
  }
  // A withholding belongs in the limits too: the biggest thing this reader is not being shown.
  if (d.tree && d.tree.withheld === true) {
    out.push('The tree-wide scan was not run for this account, so nothing below covers transitive '
      + `packages${d.tree.requires ? ` (requires ${d.tree.requires})` : ''}.`);
  }
  for (const l of (d.tree && d.tree.coverage && d.tree.coverage.limits) || []) out.push(String(l));
  for (const f of Array.isArray(d.failures) ? d.failures : []) {
    out.push(`${f.name}: not checked — ${f.reason}`);
  }
  // Said once, always, regardless of what the scans returned.
  out.push('Nothing here is applied automatically. Every fix is master\u2019s to perform.');
  return out;
}

/** A one-line summary for a collapsed card. Never a score. */
export function oneLine(payload) {
  const s = state(payload);
  // `withheld` and `partial` both still have the narrow number to report, so they fall through to
  // the count rather than to the title. `idle` and `failed` have no number and must not imply one.
  if (s.kind !== 'ready' && s.kind !== 'partial' && s.kind !== 'withheld') return s.title;
  const h = headline(payload);
  if (h.wide.found === null) return `${dash(h.narrow.found)} found among direct dependencies only`;
  return `${h.wide.found} advisory(ies) across ${dash(h.wide.asked)} installed packages`;
}
