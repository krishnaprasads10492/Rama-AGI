'use strict';

/**
 * verifyProposal.cjs — attach a verification report to a proposal before a human
 * decides on it.
 *
 * WHAT THIS IS: static analysis, not a proof. `astEngine.analyzeFile` computes a
 * quality score and lists concrete issues (empty catches, console.log left in,
 * TODO/FIXME markers, cyclomatic complexity) for each file a proposal would
 * write. It is real signal, honestly labelled — not the "formal proof generator"
 * or theorem-proving language from the architecture poster (section 36), which
 * this project has no toolchain for and will not claim to have.
 *
 * WHAT THIS IS NOT: it does not gate `proposals.apply()`. The approval invariant
 * (I6) is unchanged — a human still decides. This only changes what the human
 * sees while deciding, by writing into `proposal.meta.verification`.
 *
 * For a `patch`, the analysis runs on the NEW content (what would land), and
 * separately on whatever currently exists at that path (the baseline), so a
 * proposal can be judged as "improves quality" or "introduces N new issues"
 * rather than in isolation.
 */

const fs   = require('fs');
const os   = require('os');
const path = require('path');

/**
 * @param {object} proposal   a proposals.cjs record (or a def about to become one)
 * @returns {Promise<object>} verification report — never throws, degrades to
 *          `{ ok:false, reason }` per file if AST analysis is unavailable.
 */
async function verifyProposal(proposal) {
  const changes = Array.isArray(proposal?.changes) ? proposal.changes : [];
  const writeChanges = changes.filter(c => c.action === 'create' || c.action === 'patch');

  if (writeChanges.length === 0) {
    return { ok: true, files: [], summary: 'No file writes to verify', avgQuality: null };
  }

  let astEngine;
  try { astEngine = require('../ipc/astEngine.cjs'); }
  catch (err) {
    return { ok: false, reason: `AST engine unavailable: ${err.message}`, files: [] };
  }

  const files = [];

  for (const change of writeChanges) {
    const ext = path.extname(change.path || '') || '.txt';

    // analyzeFile reads from disk, so the NEW content is written to a scratch
    // file rather than teaching the analyzer to accept a string — keeps this
    // module decoupled from astEngine's internals.
    const scratchPath = path.join(os.tmpdir(), `rama-verify-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);

    let after = null;
    let before = null;

    try {
      fs.writeFileSync(scratchPath, change.content ?? '', 'utf8');
      after = await astEngine.analyzeFile(scratchPath);
    } catch (err) {
      after = { error: err.message };
    } finally {
      try { fs.unlinkSync(scratchPath); } catch { /* best effort */ }
    }

    if (change.action === 'patch' && change.path && fs.existsSync(change.path)) {
      try { before = await astEngine.analyzeFile(change.path); }
      catch { before = null; }
    }

    files.push({
      path: change.path,
      action: change.action,
      qualityAfter:  after?.qualityScore ?? null,
      qualityBefore: before?.qualityScore ?? null,
      delta: (after?.qualityScore != null && before?.qualityScore != null)
        ? after.qualityScore - before.qualityScore
        : null,
      issues: (after?.issues ?? []).map(i => ({ type: i.type, severity: i.severity, message: i.message, line: i.line })),
      error: after?.error ?? null,
    });
  }

  const scored = files.filter(f => f.qualityAfter != null);
  const avgQuality = scored.length
    ? Math.round(scored.reduce((s, f) => s + f.qualityAfter, 0) / scored.length)
    : null;

  const improved  = files.filter(f => f.delta != null && f.delta > 0).length;
  const regressed = files.filter(f => f.delta != null && f.delta < 0).length;
  const totalIssues = files.reduce((s, f) => s + f.issues.length, 0);

  return {
    ok: true,
    files,
    avgQuality,
    totalIssues,
    improved,
    regressed,
    summary: avgQuality != null
      ? `avg quality ${avgQuality}/100 across ${files.length} file(s)` +
        (regressed > 0 ? ` — ${regressed} regressed` : improved > 0 ? ` — ${improved} improved` : '')
      : `${files.length} file(s), quality unscored`,
  };
}

/**
 * Convenience: create a proposal and attach its verification in one call, so
 * callers do not have to remember the two-step order.
 */
async function createVerified(ledger, def) {
  const proposal = ledger.create(def);
  try {
    const report = await verifyProposal(proposal);
    proposal.meta = { ...proposal.meta, verification: report };
  } catch (err) {
    proposal.meta = { ...proposal.meta, verification: { ok: false, reason: err.message, files: [] } };
  }
  return proposal;
}

module.exports = { verifyProposal, createVerified };
