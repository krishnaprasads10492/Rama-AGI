'use strict';

/**
 * verifySelfModel.cjs — the self-description, and whether it can be trusted (Section 88).
 *
 * This module's entire value is that it does not overstate. So the assertions here are mostly
 * NEGATIVE: that an absent probe produces `null` rather than a comforting default, that a limit
 * disappears when the condition causing it goes away, and above all that the loyalty matrix is
 * never disclosed no matter what a probe hands back.
 *
 * The dangerous failure for a "describe yourself" call is not a crash — it is quietly reporting
 * capability that is not there. A crash is visible; a flattering lie is not. Hence the emphasis.
 *
 * Every probe is injected, so this runs under plain node with no Electron and no real state.
 *
 * Run: node scripts/verifySelfModel.cjs   (or npm run verify:self)
 */

const selfModel = require('../electron/lib/selfModel.cjs');

let pass = 0;
let fail = 0;

function check(label, ok, detail) {
  if (ok) {
    pass += 1;
    console.log(`  PASS  ${label}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${label}${detail ? ` - ${detail}` : ''}`);
  }
}

/** A fully-capable Rāma: everything available, nothing to complain about. */
function healthyProbes() {
  return {
    app: () => ({ name: 'Rāma', version: '1.2.0', packaged: true }),
    nucleus: () => ({ sealed: true, verified: true }),
    instance: () => ({ role: 'primary', genesExpressed: 28, totalGenes: 30 }),
    tiers: () => ({
      reflex: { available: true, skills: 12 },
      local: { available: true },
      cloud: { available: true },
      highest: 2,
    }),
    capabilities: () => ({ total: 104, forUser: 104 }),
    engines: () => ({ python: { running: true }, voiceLevel: 3, archiverBlocked: false }),
    workspace: () => ({ known: 4, pinned: 2 }),
    models: () => ({ gatePassing: 2 }),
    experience: () => ({
      recorded: 400, reflexServed: 120, escalated: 280, reflexRate: 30,
      failures: 6, promptTextRecorded: true,
    }),
  };
}

/** The opposite: nothing is available and the machine is constrained. */
function starvedProbes() {
  return {
    app: () => ({ name: 'Rāma', version: '1.2.0', packaged: false }),
    nucleus: () => ({ sealed: false }),
    tiers: () => ({
      reflex: { available: true, skills: 12 },
      local: { available: false, reason: 'no local model detected' },
      cloud: { available: false, reason: 'no provider key in the vault' },
      highest: 0,
    }),
    capabilities: () => ({ total: 104, forUser: 3 }),
    engines: () => ({ python: { running: false }, voiceLevel: 0, archiverBlocked: true }),
    workspace: () => ({ known: 0, pinned: 0 }),
    models: () => ({ gatePassing: 0 }),
    experience: () => ({
      recorded: 0, reflexServed: 0, escalated: 0, reflexRate: 0,
      failures: 0, promptTextRecorded: false,
    }),
  };
}

const whats = (m) => m.limits.map(l => l.what).join(' | ');
const hasLimit = (m, frag) => m.limits.some(l => l.what.includes(frag) || l.why.includes(frag));

(async () => {
  console.log('\nselfModel — identity, ability and honest limits\n');

  // ── 1. No probes at all: the hardest honesty case ──────────────────────────
  console.log('  no probes available');
  {
    const m = await selfModel.describe({});

    check('describe() resolves with no probes at all', !!m && !!m.identity);
    check('an unread field is null, not a default',
      m.identity.version.value === null, JSON.stringify(m.identity.version));
    check('an unread field is marked measured:false',
      m.identity.version.measured === false);
    check('an unread field explains why nothing was read',
      typeof m.identity.version.why === 'string' && m.identity.version.why.length > 0);
    check('ability reports null rather than zero for unread reflex count',
      m.ability.reflexSkills.value === null, JSON.stringify(m.ability.reflexSkills));
    check('sources list is empty when nothing answered',
      Array.isArray(m.attestation.sources) && m.attestation.sources.length === 0);
    // A self-model with nothing to report must say so, not produce a cheerful empty summary.
    check('summary states the absence rather than implying capability',
      /Nothing measurable/i.test(m.summary.text), m.summary.text);
    check('canDo is not silently empty-but-positive',
      m.summary.canDo.length === 1 && /very little/i.test(m.summary.canDo[0]));
    check('an unqueryable nucleus does not read as unsealed',
      m.identity.loyalty.measured === false,
      JSON.stringify(m.identity.loyalty));
  }

  // ── 2. A throwing / hostile probe must not become a claim ──────────────────
  console.log('\n  probes that throw or return rubbish');
  {
    const m = await selfModel.describe({
      app: () => { throw new Error('boom'); },
      tiers: async () => { throw new Error('async boom'); },
      nucleus: () => undefined,
      experience: () => null,
      engines: 'not a function',
      capabilities: () => ({ total: 104, forUser: 104 }),
    });

    check('a throwing sync probe degrades to unmeasured',
      m.identity.version.measured === false);
    check('a throwing async probe degrades to unmeasured',
      m.ability.localModel.measured === false);
    check('a probe returning undefined degrades to unmeasured',
      m.identity.loyalty.measured === false);
    check('a non-function probe does not throw',
      m.ability.marketEngine.measured === false);
    check('a probe that did answer is still reported',
      m.ability.gatedCapabilities.value === 104);
    check('only the probes that answered are cited as sources',
      m.attestation.sources.length === 1
      && m.attestation.sources[0] === 'shared/capabilities.json',
      JSON.stringify(m.attestation.sources));
    // Absent experience must not be reported as a measured reflexRate of 0 — that reads as
    // "measured, and the answer is zero", which is a different and false claim.
    check('missing experience is not reported as a measured 0% reflex rate',
      m.experience.reflexRate.value === null && m.experience.reflexRate.measured === false);
  }

  // ── 3. Healthy: capability reported, and NO invented limits ────────────────
  console.log('\n  everything available');
  {
    const m = await selfModel.describe(healthyProbes());

    check('local model reported available', m.ability.localModel.value === true);
    check('cloud model reported available', m.ability.cloudModel.value === true);
    check('market engine reported running', m.ability.marketEngine.value === 'running');
    check('reflex skill count passed through', m.ability.reflexSkills.value === 12);
    check('projects known passed through', m.ability.projectsKnown.value === 4);
    check('genome rendered as expressed-of-total when both are known',
      m.identity.genome.value === '28 of 30 genes expressed', m.identity.genome.value);
    check('reflexRate measured when present',
      m.experience.reflexRate.value === 30 && m.experience.reflexRate.measured === true);

    // The point of deriving limits: a healthy install must not carry stale complaints.
    check('no limits are invented when nothing is missing',
      m.limits.length === 0, whats(m));
    check('summary lists real abilities', m.summary.canDo.length >= 4, JSON.stringify(m.summary.canDo));
    check('summary never claims "0 things I cannot do"',
      !/\b0 things\b/.test(m.summary.text), m.summary.text);
    check('a healthy summary says nothing checked for is missing',
      /Nothing I checked for is currently missing/.test(m.summary.text), m.summary.text);
    check('every ability field carries a source',
      Object.values(m.ability).every(f => typeof f.source === 'string' && f.source.length > 0));
    check('every identity field carries a source',
      Object.values(m.identity).every(f => typeof f.source === 'string' && f.source.length > 0));
  }

  // ── 4. Starved: every limit derived, each with a reason ────────────────────
  console.log('\n  nothing available');
  {
    const m = await selfModel.describe(starvedProbes());

    check('derives the missing-local-model limit', hasLimit(m, 'without the network'), whats(m));
    check('derives the no-cloud-model limit', hasLimit(m, 'cloud model'), whats(m));
    check('derives the market-engine-down limit', hasLimit(m, 'about markets'), whats(m));
    check('derives the no-validated-forecast limit', hasLimit(m, 'validated market forecast'), whats(m));
    check('derives the blocked-archiver limit', hasLimit(m, 'installer'), whats(m));
    check('derives the unsealed-nucleus limit', hasLimit(m, 'sealed nucleus'), whats(m));
    check('derives the no-baseline limit', hasLimit(m, 'whether it is improving'), whats(m));

    // The Section 88 finding must be visible in the product, not only in the ledger.
    check('derives the tier-3 limit when request text is not recorded',
      hasLimit(m, 'permanent free skill'), whats(m));
    check('the tier-3 limit explains it is a data-shape defect',
      m.limits.some(l => /never what was ASKED|which TOOL answered/.test(l.why)), whats(m));

    check('every limit carries a why', m.limits.every(l => l.why && l.why.length > 10));
    check('every limit carries a source', m.limits.every(l => l.source && l.source.length > 0));
    check('every limit is marked measured', m.limits.every(l => l.measured === true));
    check('limits that have a remedy state it',
      m.limits.filter(l => l.fixable).length >= 5,
      `${m.limits.filter(l => l.fixable).length} of ${m.limits.length}`);
    check('limitCount matches the derived list', m.summary.limitCount === m.limits.length);
    check('summary still reports the reflex tier as usable',
      m.summary.canDo.some(s => /no model at all/.test(s)), JSON.stringify(m.summary.canDo));
    check('an unsealed core is reported as not sealed',
      m.identity.loyalty.value === 'not sealed', JSON.stringify(m.identity.loyalty));
  }

  // ── 4b. Partial knowledge must degrade, not fabricate ──────────────────────
  // These are the exact shapes the real main-process probes hand over: the host knows the genome
  // size but not an expressed count, and the reflex registry lives in the renderer.
  console.log('\n  partially-known values degrade instead of reading as zero');
  {
    const probes = healthyProbes();
    probes.instance = () => ({ role: null, genesExpressed: null, totalGenes: 30 });
    probes.tiers = () => ({
      reflex: { available: true, skills: null },
      local: { available: true }, cloud: { available: true }, highest: 2,
    });
    const m = await selfModel.describe(probes);

    check('genome shows the total alone when the expressed count is unknown',
      m.identity.genome.value === '30 genes', m.identity.genome.value);
    check('genome never renders a "?" placeholder',
      !/\?/.test(String(m.identity.genome.value)), m.identity.genome.value);
    check('an unknown role is unmeasured, not guessed as prime',
      m.identity.role.value === null);
    // The bug this guards: `{reflex:{skills:null}}` reporting measured:true with value null.
    check('a null skill count is unmeasured, not a measured zero',
      m.ability.reflexSkills.value === null && m.ability.reflexSkills.measured === false,
      JSON.stringify(m.ability.reflexSkills));
    check('the unmeasured skill count explains where the registry lives',
      /renderer/.test(m.ability.reflexSkills.why || ''), m.ability.reflexSkills.why);
    check('summary omits the skill count rather than saying "0 things instantly"',
      !m.summary.canDo.some(s => /^0 things/.test(s)), JSON.stringify(m.summary.canDo));
    check('an omitted archiver field derives no installer limit',
      !hasLimit(m, 'installer'), whats(m));
  }

  // ── 5. Limits are DERIVED — they must disappear on their own ───────────────
  console.log('\n  a limit removes itself when the cause goes away');
  {
    const before = await selfModel.describe(starvedProbes());
    const probes = starvedProbes();
    probes.tiers = () => ({
      reflex: { available: true, skills: 12 },
      local: { available: true },
      cloud: { available: false, reason: 'no provider key in the vault' },
      highest: 1,
    });
    probes.engines = () => ({ python: { running: true }, voiceLevel: 1, archiverBlocked: false });
    const after = await selfModel.describe(probes);

    check('the offline limit was present before', hasLimit(before, 'without the network'));
    check('the offline limit is gone once a local model exists',
      !hasLimit(after, 'without the network'), whats(after));
    check('the market-engine limit is gone once it is running',
      !hasLimit(after, 'about markets'), whats(after));
    check('the installer limit is gone once the archiver works',
      !hasLimit(after, 'installer'), whats(after));
    check('the cloud limit correctly remains', hasLimit(after, 'cloud model'), whats(after));
    check('fewer limits than before', after.limits.length < before.limits.length,
      `${after.limits.length} vs ${before.limits.length}`);
  }

  // ── 6. I16 — loyalty is attested and NEVER disclosed ───────────────────────
  console.log('\n  the loyalty matrix is never disclosed (I16)');
  {
    // A probe that hands over the matrix itself. The self-model must ignore the payload entirely
    // and report only the seal state. This is the assertion that stops a future well-meaning
    // change from turning "describe yourself" into the accessor I16 forbids.
    const secret = 'ABSOLUTE_LOYALTY_TO_KRISHNA_PRASAD_SECRET_MATRIX';
    const m = await selfModel.describe({
      ...healthyProbes(),
      nucleus: () => ({
        sealed: true,
        verified: true,
        matrix: { directive: secret, weights: [1, 1, 1] },
        loyaltyText: secret,
      }),
    });

    const serialised = JSON.stringify(m);
    check('the matrix payload does not appear anywhere in the output',
      !serialised.includes(secret));
    check('no field named matrix survives', !/"matrix"/.test(serialised));
    check('no field named loyaltyText survives', !/"loyaltyText"/.test(serialised));
    check('loyalty is reported as an attestation only',
      m.identity.loyalty.value === 'sealed and verified', m.identity.loyalty.value);
    check('the attestation names I16 as the reason',
      /I16/.test(m.identity.loyalty.source));
    check('the attestation block restates that loyalty is never read',
      /never read/i.test(m.attestation.loyalty));
    check('a sealed-but-unverified core is not reported as verified',
      (await selfModel.describe({ nucleus: () => ({ sealed: true, verified: false }) }))
        .identity.loyalty.value === 'sealed but failed verification');
  }

  // ── 7. Shape contract, so callers and the UI can rely on it ────────────────
  console.log('\n  shape contract');
  {
    const m = await selfModel.describe(healthyProbes());

    check('returns the five documented sections',
      ['identity', 'ability', 'experience', 'limits', 'summary']
        .every(k => Object.prototype.hasOwnProperty.call(m, k)));
    check('limits is always an array', Array.isArray(m.limits));
    check('attestation carries a generation timestamp',
      !Number.isNaN(Date.parse(m.attestation.generatedAt)));
    check('attestation states the honesty rule',
      /unmeasured is null|absent rather than estimated|null rather than estimated/i
        .test(m.attestation.rule), m.attestation.rule);
    check('sources are de-duplicated',
      new Set(m.attestation.sources).size === m.attestation.sources.length);
    check('the whole model serialises for IPC',
      typeof JSON.parse(JSON.stringify(m)) === 'object');
    check('fact() marks a value measured', selfModel.fact(1, 's').measured === true);
    check('unmeasured() never carries a value', selfModel.unmeasured('s').value === null);
  }

  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})();
