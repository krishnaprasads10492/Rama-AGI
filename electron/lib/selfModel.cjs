'use strict';

/**
 * selfModel.cjs — the subject that Rāma's capabilities belong to (spec Section 88).
 *
 * Master's question: *"without any 'self' how would all capabilities get a meaning"*. That is a
 * correct architectural observation, not a philosophical aside. Rāma's self-knowledge existed in
 * five places that never composed:
 *
 *   cognition.capabilities()      which tiers can answer right now
 *   registry.allCapabilities()    the names of gated capabilities
 *   metaCognition                 what has been done and how it went
 *   genome / instanceManager      which genes are expressed, which role
 *   loyaltyCore                   who Rāma is for
 *
 * Each is true and none is a self. A capability list with no subject is a menu; the same list with
 * a subject that also knows its own LIMITS is an account of ability. This module is that subject.
 *
 * ─── WHAT THIS IS NOT ────────────────────────────────────────────────────────
 *
 * A self-MODEL, not selfhood. It is a truthful, sourced description of what Rāma is and is not
 * able to do. It does not make Rāma aware of anything. Saying otherwise would be the same class of
 * claim Section 36 declined five times over, and the value of this module is precisely that it can
 * be trusted.
 *
 * ─── THE DESIGN RULE THAT KEEPS IT HONEST ────────────────────────────────────
 *
 * EVERY FIELD CARRIES ITS SOURCE, AND ANYTHING UNMEASURABLE IS ABSENT RATHER THAN ESTIMATED.
 * A self-description is exactly the artefact that rots into marketing — Section 51 had to build a
 * three-column audit separating what was real from what the architecture posters claimed. So:
 * `{ value, source, measured }` on everything, `null` where nothing was measured, and no field is
 * ever filled in from a constant that someone will forget to update.
 *
 * ─── LIMITS ARE DERIVED, NOT LISTED ──────────────────────────────────────────
 *
 * The most valuable thing here is `limits`, and it is computed from measurement rather than from a
 * hand-maintained list. A hardcoded "known limitations" array is stale the day after it is written
 * and then actively lies. Every limit below is inferred from something absent RIGHT NOW — no local
 * model, a locked vault, no gate-passing forecaster — so it corrects itself when the situation does.
 *
 * ─── LOYALTY IS ATTESTED, NEVER READ ─────────────────────────────────────────
 *
 * I16 says no accessor ever returns the loyalty matrix. So identity here reports only whether the
 * core is sealed and verified — an attestation, not a disclosure. The self-model must never become
 * the accessor that invariant forbids.
 *
 * Every probe is INJECTED, so this composes in the main process and tests under plain node.
 */

const DEFAULT_PROBES = {};

/** `{value, source, measured}` — the shape that makes a claim auditable. */
function fact(value, source, measured = true) {
  return { value, source, measured: !!measured };
}

/** Nothing was measured. Deliberately not `0`, `false` or "unknown" — those read as findings. */
function unmeasured(source, why) {
  return { value: null, source, measured: false, why: why || 'not measured' };
}

async function settle(fn, fallback = null) {
  if (typeof fn !== 'function') return fallback;
  try {
    const v = await fn();
    return v === undefined ? fallback : v;
  } catch {
    return fallback;
  }
}

/**
 * Compose the account.
 *
 * @param {object} probes  injected readers — each optional, each may throw or be absent, and an
 *                         absent probe becomes an unmeasured field rather than a guess.
 */
async function describe(probes = DEFAULT_PROBES) {
  const p = { ...DEFAULT_PROBES, ...probes };
  const sources = [];
  const note = (s) => { if (!sources.includes(s)) sources.push(s); };

  // ── Identity ──────────────────────────────────────────────────────────────
  const app = await settle(p.app);                    // { name, version, packaged }
  const nucleus = await settle(p.nucleus);            // { sealed, verified }
  const instance = await settle(p.instance);          // { role, genesExpressed, totalGenes }
  const serves = await settle(p.serves);              // display name only (I16-safe)

  if (serves) note('loyalty core (display name only)');
  if (app) note('app metadata');
  if (nucleus) note('nucleus sealer');
  if (instance) note('genome / instance manager');

  const identity = {
    name: app ? fact(app.name || 'Rāma', 'app metadata') : unmeasured('app metadata'),
    version: app ? fact(app.version || null, 'package.json') : unmeasured('app metadata'),
    packaged: app ? fact(!!app.packaged, 'electron app.isPackaged') : unmeasured('app metadata'),
    // ATTESTATION, NOT DISCLOSURE (I16). Whether the core is sealed, never what it contains.
    loyalty: nucleus
      ? fact(
        nucleus.sealed
          ? (nucleus.verified === false
            ? 'sealed but failed verification'
            : 'sealed and verified')
          : 'not sealed',
        'nucleus sealer — attestation only; the loyalty matrix is never read (I16)',
      )
      : unmeasured('nucleus sealer', 'the nucleus could not be queried'),
    // Master's display name via `loyaltyCore.displayIdentity()` — the ONE sanctioned field, and
    // the reason it is sanctioned is that it is a name and not the matrix (Section 56).
    serves: serves
      ? fact(serves, 'loyaltyCore.displayIdentity() — display name only, never the matrix')
      : unmeasured('loyalty core', 'the core is locked or unavailable'),
    role: instance ? fact(instance.role || null, 'instance manager') : unmeasured('instance manager'),
    // The expressed fraction is only shown when BOTH numbers are known. A role is a lens over the
    // genome and no single local role is recorded for the host process, so "? of 30" would invite
    // the reader to supply the missing half themselves.
    genome: instance && instance.totalGenes
      ? fact(
        instance.genesExpressed != null
          ? `${instance.genesExpressed} of ${instance.totalGenes} genes expressed`
          : `${instance.totalGenes} genes`,
        'genome',
      )
      : unmeasured('genome'),
  };

  // ── Ability: what can answer right now ────────────────────────────────────
  const tiers = await settle(p.tiers);                // { reflex:{skills}, local:{available}, cloud:{available} }
  const caps = await settle(p.capabilities);          // { total, forUser }
  const engines = await settle(p.engines);            // { python:{running}, voiceLevel, ... }
  const workspace = await settle(p.workspace);        // { known, pinned }
  const models = await settle(p.models);              // { available:[], trained }

  if (tiers) note('cognition ladder');
  if (caps) note('shared/capabilities.json');
  if (engines) note('process + voice probes');
  if (workspace) note('workspace registry');
  if (models) note('model router / registry');

  const ability = {
    // Guarded on the NUMBER, not on the parent object: `{reflex:{skills:null}}` would otherwise
    // produce `{value:null, measured:true}`, which reads as "measured, and the answer is nothing".
    reflexSkills: Number.isFinite(tiers?.reflex?.skills)
      ? fact(tiers.reflex.skills, 'cognition tier 0 registry')
      : unmeasured('cognition tier 0 registry', 'the skill registry lives in the renderer'),
    localModel: tiers?.local
      ? fact(!!tiers.local.available, 'cognition ladder (measured, not assumed)')
      : unmeasured('cognition ladder'),
    cloudModel: tiers?.cloud
      ? fact(!!tiers.cloud.available, 'cognition ladder (measured, not assumed)')
      : unmeasured('cognition ladder'),
    highestTier: tiers ? fact(tiers.highest ?? 0, 'cognition ladder') : unmeasured('cognition ladder'),
    gatedCapabilities: caps
      ? fact(caps.total ?? null, 'shared/capabilities.json')
      : unmeasured('capability matrix'),
    capabilitiesForThisUser: caps && caps.forUser != null
      ? fact(caps.forUser, 'capability matrix + current tier')
      : unmeasured('capability matrix'),
    marketEngine: engines
      ? fact(engines.python?.running ? 'running' : 'not running', 'aiProcess status')
      : unmeasured('aiProcess'),
    voiceLevel: engines && engines.voiceLevel != null
      ? fact(engines.voiceLevel, 'voice engine ladder')
      : unmeasured('voice engine'),
    projectsKnown: workspace
      ? fact(workspace.known ?? 0, 'workspace registry')
      : unmeasured('workspace registry'),
  };

  // ── Experience: what has actually happened ────────────────────────────────
  const exp = await settle(p.experience);   // { recorded, reflexServed, escalated, reflexRate, failures }
  if (exp) note('experiential dataset');

  const experience = exp
    ? {
      recorded: fact(exp.recorded ?? 0, 'experiential dataset'),
      answeredWithoutAModel: fact(exp.reflexServed ?? 0, 'experiential dataset'),
      escalatedToAModel: fact(exp.escalated ?? 0, 'experiential dataset'),
      // The one number that would show Rāma getting cheaper and more capable over time.
      reflexRate: fact(exp.reflexRate ?? null, 'experiential dataset',
        exp.reflexRate != null),
      failures: fact(exp.failures ?? null, 'experiential dataset', exp.failures != null),
    }
    : {
      recorded: unmeasured('experiential dataset', 'metaCognition unavailable'),
      reflexRate: unmeasured('experiential dataset', 'metaCognition unavailable'),
    };

  // ── Limits, DERIVED ───────────────────────────────────────────────────────
  const limits = [];
  const limit = (what, why, source, fixable = null) =>
    limits.push({ what, why, source, fixable, measured: true });

  if (tiers?.local && !tiers.local.available) {
    limit('cannot answer a hard question without the network',
      tiers.local.reason || 'no local model detected',
      'cognition ladder',
      'install Ollama and pull a model — tier 1 then works offline and free');
  }
  if (tiers?.cloud && !tiers.cloud.available) {
    limit('cannot reach a cloud model',
      tiers.cloud.reason || 'no provider key available',
      'cognition ladder',
      'unlock the vault, or add a provider key under Models');
  }
  if (engines && engines.python && !engines.python.running) {
    limit('cannot answer anything about markets',
      'the Python engine is not running',
      'aiProcess status',
      'open StockMind — the engine starts on first use');
  }
  if (models && models.gatePassing === 0) {
    limit('cannot give a validated market forecast',
      'no model has cleared the acceptance gate on real data, so every directional reading is '
      + 'reported but not actionable',
      'training provenance (Section 73)',
      'exogenous data is the untested lever — news tone and derivatives, not another model type');
  }
  // THE LIMIT THAT ANSWERS MASTER'S EARLIER QUESTION ABOUT GROWTH.
  if (exp && exp.promptTextRecorded === false) {
    limit('cannot turn a repeated request into a permanent free skill',
      'the experiential dataset records which TOOL answered but never what was ASKED, so tier 3 '
      + 'can count escalations and cannot identify which phrasing to convert into a reflex',
      'metaCognition.recordOutcome fields (Section 88)',
      'record the request text — which has a privacy consequence master must accept first');
  }
  if (engines && engines.archiverBlocked) {
    limit('cannot build an installer on this machine',
      'endpoint policy blocks the bundled 7-Zip, so packaging can only produce an unpacked tree '
      + 'and a portable archive',
      'archiver probe (Section 45)',
      'build on a machine that can run 7za, or install a system 7-Zip');
  }
  if (nucleus && nucleus.sealed === false) {
    limit('running without a sealed nucleus',
      'identity and loyalty are not sealed, so nothing below depends on a verified core',
      'nucleus sealer');
  }
  if (!exp || exp.recorded === 0) {
    limit('cannot say whether it is improving',
      'nothing has been recorded yet, so there is no baseline to compare against',
      'experiential dataset',
      'use Rāma — the record accumulates from ordinary use');
  }

  // ── The honest summary ────────────────────────────────────────────────────
  const canDo = [];
  if (ability.reflexSkills.value) {
    canDo.push(`${ability.reflexSkills.value} things instantly with no model at all`);
  }
  if (ability.localModel.value) canDo.push('reason locally, offline and free');
  if (ability.cloudModel.value) canDo.push('reach a cloud model for hard work');
  if (ability.marketEngine.value === 'running') canDo.push('analyse markets');
  if (ability.projectsKnown.value) {
    canDo.push(`work in ${ability.projectsKnown.value} project${ability.projectsKnown.value === 1 ? '' : 's'} it remembers`);
  }

  return {
    identity,
    ability,
    experience,
    limits,
    summary: {
      // Written so that the limits are not an appendix. A self-description that lists only what it
      // can do is the thing this module exists to avoid being.
      canDo: canDo.length ? canDo : ['very little — nothing has been measured as available'],
      limitCount: limits.length,
      text: canDo.length
        ? `I can ${canDo.join('; ')}. `
          + (limits.length === 0
            ? 'Nothing I checked for is currently missing.'
            : `There ${limits.length === 1 ? 'is 1 thing' : `are ${limits.length} things`} `
              + 'I cannot currently do, and each one names why and what would change it.')
        : 'Nothing measurable is available to me right now, which is itself the finding.',
    },
    attestation: {
      generatedAt: new Date().toISOString(),
      sources,
      rule: 'Every field carries its source. Anything unmeasured is null rather than estimated, '
        + 'and limits are derived from what is absent right now rather than from a maintained list.',
      loyalty: 'The loyalty matrix is never read by this module — only attested as sealed (I16).',
    },
  };
}

module.exports = { describe, fact, unmeasured };
