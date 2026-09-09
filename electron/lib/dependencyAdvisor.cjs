'use strict';

/**
 * dependencyAdvisor.cjs — what could be upgraded, what it would cost, and what could go wrong.
 *
 * Master: *"fetch, study, analyze, read comments online for info, consider various things related to
 * RAMA, its security and system impact like diskspace, then consider for upgradation and put it in
 * the master's approval list. For this RAMA needs to verify every day online."* (spec Section 96)
 *
 * IT NEVER UPGRADES ANYTHING. I12 pins every dependency deliberately; an advisor that could act would
 * turn a pinned set into a moving one, which is the opposite of what pinning is for. It produces an
 * assessment and files it through the approval ledger that already exists.
 *
 * Every function here is pure with the registry lookup injected, so the judgement — which is the part
 * that can be wrong in a costly way — is testable without a network.
 */

const semverRe = /^(\d+)\.(\d+)\.(\d+)/;

/** Packages whose upgrade has consequences beyond themselves, so they are never "routine". */
const SENSITIVE = new Set([
  'electron',          // renderer/main API surface, CSP behaviour, Node version
  'electron-builder',  // packaging, and Section 90's upgrade identity
  'electron-updater',  // the only repair channel an install has
  'argon2',            // passcode hashing: a change here can lock master out
  'node-pty',          // native, and the terminal's fallback path
  'playwright',        // browser automation, and Section 94's assimilation
  'vite',              // the renderer build
  'react',
  'react-dom',
]);

function parse(version) {
  const m = semverRe.exec(String(version || '').replace(/^[^\d]*/, ''));
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

/**
 * How big a jump is this, in the terms the author intended?
 *
 * A MAJOR BUMP IS `breaking` BY DEFAULT, because semantic versioning means the author is telling you
 * it breaks something. Ranking upgrades by recency would bury that; classifying by the author's own
 * signal surfaces it.
 */
function classifyJump(from, to) {
  const a = parse(from);
  const b = parse(to);
  if (!a || !b) return { kind: 'unknown', why: 'one of the versions is not semver' };

  if (b.major > a.major) {
    return {
      kind: 'breaking',
      why: `major ${a.major} → ${b.major}: the author is signalling an incompatible change`,
    };
  }
  if (b.major < a.major || (b.major === a.major && (b.minor < a.minor
      || (b.minor === a.minor && b.patch < a.patch)))) {
    return { kind: 'downgrade', why: 'the registry version is older than the pinned one' };
  }
  if (b.minor > a.minor) {
    return { kind: 'feature', why: `minor ${a.minor} → ${b.minor}: additive, but new code paths` };
  }
  if (b.patch > a.patch) {
    return { kind: 'patch', why: `patch ${a.patch} → ${b.patch}: intended as a fix only` };
  }
  return { kind: 'current', why: 'already at the registry version' };
}

/**
 * Assess one package.
 *
 * @param {object} input
 * @param {string} input.name
 * @param {string} input.pinned           the version in package.json
 * @param {string} input.latest           the registry's newest
 * @param {object} [input.advisory]       `{checked:boolean, found:Array}` from an advisory source
 * @param {number} [input.sizeBytes]      current unpacked size, if known
 * @param {number} [input.latestSizeBytes]
 * @param {Array}  [input.signals]        `[{claim, source, date}]` — online commentary
 * @param {number} [input.releaseAgeDays] how long the new version has been out
 */
function assess(input = {}) {
  const {
    name, pinned, latest,
    advisory = null,
    sizeBytes = null, latestSizeBytes = null,
    signals = [], releaseAgeDays = null,
  } = input;

  const jump = classifyJump(pinned, latest);
  const sensitive = SENSITIVE.has(name);

  // ── Security ─────────────────────────────────────────────────────────────
  //
  // THE MOST TEMPTING DISHONESTY IN THIS MODULE. An advisory lookup that returns nothing may mean the
  // package is clean, or may mean nobody looked. `verified-clean` is only ever claimed when a check
  // actually ran; otherwise the state is `no-advisory-found`, which is a different sentence.
  let security;
  if (!advisory || advisory.checked !== true) {
    security = {
      state: 'unchecked',
      fixes: [],
      note: 'no advisory source was consulted, so nothing is known either way',
    };
  } else if (Array.isArray(advisory.found) && advisory.found.length > 0) {
    security = {
      state: 'vulnerable',
      fixes: advisory.found,
      note: `${advisory.found.length} advisory(ies) affect the pinned version`,
    };
  } else {
    security = {
      state: 'no-advisory-found',
      fixes: [],
      note: 'the advisory source returned nothing for this package — which is not the same as a '
        + 'guarantee that it is safe',
    };
  }

  // ── Disk, master's binding constraint ────────────────────────────────────
  //
  // Reported as a DELTA: "42 MB" matters far less than "+31 MB". Absent rather than zero when unknown.
  const diskDeltaBytes = (Number.isFinite(sizeBytes) && Number.isFinite(latestSizeBytes))
    ? latestSizeBytes - sizeBytes
    : null;

  // ── Concerns, each traceable to its cause ────────────────────────────────
  const concerns = [];
  if (jump.kind === 'breaking') concerns.push(`Breaking: ${jump.why}.`);
  if (jump.kind === 'downgrade') {
    concerns.push('The registry reports an OLDER version than the pin, which usually means the '
      + 'release was pulled — investigate before changing anything.');
  }
  if (sensitive) {
    concerns.push(`${name} affects Rāma beyond itself; an upgrade needs a build and a launch test.`);
  }
  if (diskDeltaBytes !== null && diskDeltaBytes > 20 * 1024 * 1024) {
    concerns.push(`Adds about ${Math.round(diskDeltaBytes / 1024 / 1024)} MB to the install.`);
  }
  if (Number.isFinite(releaseAgeDays) && releaseAgeDays < 7 && jump.kind !== 'patch') {
    // Being first to a release is a cost, not a benefit, for a system master depends on.
    concerns.push(`Released ${releaseAgeDays} day(s) ago; early adopters find the regressions.`);
  }
  if (security.state === 'unchecked') {
    concerns.push('Security status is unknown because no advisory source was consulted.');
  }

  // ── Online commentary: signal, never measurement ─────────────────────────
  //
  // Master asked Rāma to read comments online. Those are CLAIMS. An issue thread saying a release is
  // broken is worth surfacing and worth attributing; it is not a fact about the package. So it is
  // kept separate from the version arithmetic and cannot by itself set the recommendation — the same
  // boundary that kept model ratings out of Section 92's scoring.
  const cleanSignals = (Array.isArray(signals) ? signals : [])
    .filter(s => s && typeof s.claim === 'string' && s.claim.trim())
    .map(s => ({
      claim: s.claim.trim(),
      source: s.source || 'unattributed',
      date: s.date || null,
      // Stated on every one, so a reader never mistakes commentary for a finding.
      status: 'unverified claim',
    }));
  const negative = cleanSignals.filter(s => /break|regress|crash|revert|broken|bug/i.test(s.claim));

  // ── Recommendation ───────────────────────────────────────────────────────
  let recommend;
  let urgency;
  if (jump.kind === 'current') {
    recommend = 'no action';
    urgency = 'none';
  } else if (jump.kind === 'downgrade' || jump.kind === 'unknown') {
    recommend = 'investigate';
    urgency = 'none';
  } else if (security.state === 'vulnerable') {
    // The one case where NOT upgrading is the bigger risk.
    recommend = 'upgrade recommended';
    urgency = jump.kind === 'breaking' ? 'high-with-care' : 'high';
  } else if (negative.length > 0) {
    recommend = 'hold';
    urgency = 'none';
  } else if (jump.kind === 'breaking' || sensitive) {
    recommend = 'master decides';
    urgency = 'low';
  } else {
    recommend = 'safe to consider';
    urgency = 'low';
  }

  return {
    name,
    pinned,
    latest,
    jump: jump.kind,
    jumpWhy: jump.why,
    sensitive,
    security,
    diskDeltaBytes,
    signals: cleanSignals,
    concerns,
    recommend,
    urgency,
    // Communication, not disclosure (Section 96): the numbers are above, this is what they mean.
    meaning: buildMeaning({ name, pinned, latest, jump, security, negative, sensitive, recommend }),
  };
}

function buildMeaning({ name, pinned, latest, jump, security, negative, sensitive, recommend }) {
  if (jump.kind === 'current') return `${name} is already at ${latest}.`;
  if (jump.kind === 'downgrade') {
    return `${name}'s registry version (${latest}) is older than the pin (${pinned}). That usually `
      + 'means the release was withdrawn, so this needs looking at rather than upgrading.';
  }
  if (security.state === 'vulnerable') {
    return `${name} ${pinned} is affected by a published advisory; ${latest} is available. `
      + (jump.kind === 'breaking'
        ? 'It is a major bump, so the fix carries a compatibility cost — but staying put carries a '
          + 'security one.'
        : 'The bump is not a major one, so this is a low-cost fix.');
  }
  if (negative.length > 0) {
    return `${latest} is available for ${name}, but ${negative.length} unverified report(s) online `
      + 'describe problems with it. Worth waiting unless master needs something in this release.';
  }
  if (jump.kind === 'breaking') {
    return `${name} ${latest} is a major bump from ${pinned}, so the author is signalling an `
      + 'incompatible change. Nothing forces this upgrade; it needs a reason.';
  }
  if (sensitive) {
    return `${name} ${pinned} → ${latest} is a routine bump, but ${name} affects Rāma beyond itself, `
      + 'so it needs a build and a launch test before it is trusted.';
  }
  return `${name} ${pinned} → ${latest} looks routine: ${jump.why}.`;
}

/**
 * Assess a whole dependency set and order it by what master should look at first.
 *
 * Sorted by urgency, not alphabetically and not by how new the release is: the point of the list is
 * that the first row is the one that matters.
 */
function review(entries = []) {
  const order = { high: 0, 'high-with-care': 1, low: 2, none: 3 };
  const rows = entries.map(assess);
  rows.sort((a, b) => (order[a.urgency] ?? 9) - (order[b.urgency] ?? 9)
    || a.name.localeCompare(b.name));

  const actionable = rows.filter(r => r.recommend !== 'no action');
  return {
    rows,
    actionable,
    summary: {
      checked: rows.length,
      vulnerable: rows.filter(r => r.security.state === 'vulnerable').length,
      breaking: rows.filter(r => r.jump === 'breaking').length,
      held: rows.filter(r => r.recommend === 'hold').length,
      upToDate: rows.filter(r => r.jump === 'current').length,
      // Said explicitly, because a zero here is otherwise read as "all clear".
      securityUnchecked: rows.filter(r => r.security.state === 'unchecked').length,
    },
  };
}

/**
 * Turn a review into one proposal for master's approval list.
 *
 * A single proposal rather than one per package: twenty separate approvals is a queue master will
 * stop reading, and the decisions are related — upgrading electron and electron-builder together is
 * one judgement, not two.
 */
function toProposal(review_, { now = new Date() } = {}) {
  const { actionable, summary } = review_;
  const urgent = actionable.filter(r => r.urgency.startsWith('high'));

  return {
    kind: 'dependency-upgrade',
    title: urgent.length
      ? `${urgent.length} dependency upgrade(s) with security relevance`
      : `${actionable.length} dependency upgrade(s) available`,
    summary: [
      `Checked ${summary.checked}; ${summary.upToDate} already current.`,
      summary.vulnerable ? `${summary.vulnerable} affected by a published advisory.` : null,
      summary.breaking ? `${summary.breaking} would be a major bump.` : null,
      summary.held ? `${summary.held} held back by unverified reports of problems.` : null,
      summary.securityUnchecked
        ? `${summary.securityUnchecked} could not be checked for advisories at all.`
        : null,
    ].filter(Boolean).join(' '),
    // No `changes`: this proposal asks a question, it does not carry an edit. Applying it is a
    // separate, deliberate act by master.
    changes: [],
    meta: {
      generatedAt: now.toISOString(),
      packages: actionable.map(r => ({
        name: r.name, pinned: r.pinned, latest: r.latest,
        jump: r.jump, urgency: r.urgency, recommend: r.recommend,
        security: r.security.state, diskDeltaBytes: r.diskDeltaBytes,
        concerns: r.concerns, meaning: r.meaning, signals: r.signals,
      })),
      summary,
    },
    risk: urgent.length ? 'high' : (summary.breaking ? 'medium' : 'low'),
    requiresRestart: actionable.some(r => r.sensitive),
  };
}

module.exports = { assess, review, classifyJump, toProposal, parse, SENSITIVE };
