'use strict';

/**
 * genomeApplier.cjs — the missing applier for GENOME-kind proposals.
 *
 * `proposals.cjs` (the single approve→apply gate, invariant I6) has carried the
 * `GENOME` kind since section 24, and `genome.cjs` has offered
 * `genome:propose-change` since the same section — but nothing was ever
 * registered to actually apply one. A genome proposal could be approved and then
 * silently fail with "No applier registered for kind \"genome\"". This closes it.
 *
 * SCOPE: a genome proposal patches the sealed nucleus (identity, loyalty, ethics,
 * capability axes) via `nucleusSealer.patchNucleus`. It never touches source code
 * — that is `SELF_MODIFY`'s job — and it never touches the gene manifest in
 * `genome.cjs` itself, which is source and goes through the normal self-modify
 * path with its own AST-verified diff.
 *
 * A genome change is high-risk by definition: it can alter loyalty, ethics, or
 * capability wiring. It goes through the SAME single approval gate as every
 * other self-change. Nothing here is exempted from invariant I6.
 */

const ledger = require('./proposals.cjs');

/**
 * @param {object} proposal  a proposals.cjs record with kind GENOME
 * @param {object} proposal.meta.nucleusPatch  the patch to merge into the nucleus
 */
async function applyGenomeProposal(proposal) {
  const nucleusSealer = require('../nucleusSealer.cjs');

  if (!nucleusSealer.isSealed()) {
    throw new Error('Cannot apply a genome change while the nucleus is locked — sign in as master first');
  }

  const patch = proposal.meta?.nucleusPatch;
  if (!patch || typeof patch !== 'object') {
    throw new Error('Genome proposal has no nucleusPatch to apply');
  }

  const before = nucleusSealer.getNucleus();
  const beforeHash = hashOf(before);

  // Deep merge, not the shallow one patchNucleus does internally for arbitrary
  // callers — a genome patch is expected to touch one nested branch
  // (e.g. capabilities.axes.planning) and must not wipe its siblings.
  const merged = deepMerge(structuredClone(before), patch);

  const res = await nucleusSealer.patchNucleus(merged);
  if (!res?.ok) throw new Error(res?.error || 'Nucleus patch failed');

  const after = nucleusSealer.getNucleus();

  return {
    applied: true,
    beforeHash,
    afterHash: hashOf(after),
    touchedKeys: topLevelDiffKeys(patch),
    requiresRestart: true,   // identity/capability changes take effect on next unseal
  };
}

function deepMerge(target, patch) {
  for (const [k, v] of Object.entries(patch ?? {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && typeof target[k] === 'object' && target[k] !== null) {
      target[k] = deepMerge({ ...target[k] }, v);
    } else {
      target[k] = v;
    }
  }
  return target;
}

function topLevelDiffKeys(patch) {
  return Object.keys(patch ?? {});
}

function hashOf(obj) {
  const crypto = require('crypto');
  try { return crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex').slice(0, 16); }
  catch { return null; }
}

/** Idempotent — safe to call from main.cjs on every boot. */
function register() {
  if (ledger.stats().appliers.includes(ledger.KINDS.GENOME)) return;
  ledger.registerApplier(ledger.KINDS.GENOME, applyGenomeProposal);
}

module.exports = { register, applyGenomeProposal, deepMerge };
