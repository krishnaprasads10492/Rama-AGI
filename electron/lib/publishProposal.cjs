'use strict';

/**
 * publishProposal.cjs — push an applied self-change proposal to its own
 * branch, with generated release notes, instead of landing on `dev`/`source`
 * directly.
 *
 * WHY THIS EXISTS: master asked for the app to be able to push a change it
 * made to itself as a NEW branch, so an old version is always reachable to
 * revert to — `dev`/`source` stay exactly as they were until master reviews
 * and merges. This is the git-native version of what releaseChannel.cjs
 * already does with tags (old tags are never deleted either), applied to the
 * self-modify/evolution/resource/genome proposal path instead of a version
 * cut.
 *
 * WHERE THIS SITS RELATIVE TO THE LEDGER (I6): the ledger's approval gate is
 * unchanged and comes FIRST — a proposal must already be `applied` (written
 * to disk, approved by master) before this module will touch git at all. This
 * module's only job is turning an already-approved, already-applied change
 * into a reviewable branch+PR-shaped artifact upstream. It does not re-open
 * or bypass the approval invariant.
 *
 * WHY A BRANCH, NOT A COMMIT ON dev/source: committing straight to dev means
 * a bad self-change is only reversible via a git revert master has to notice
 * is needed. Landing on `self-modify/<slug>` instead means dev/source are
 * physically untouched — the "old version to revert to" is simply the branch
 * master hasn't merged. Merging is a separate, manual, explicit action
 * (this module never merges).
 *
 * WHY MASTER-TRIGGERED, NOT AUTONOMOUS: same reasoning releaseChannel.cjs
 * already recorded for tags — "Rāma can say this seems worth publishing, it
 * should not decide to ship itself." Pushing needs a live git credential on
 * whatever machine is running Rāma; an unattended autonomous push would mean
 * a compromised or buggy instance could push under master's identity with no
 * one in the loop. `publishProposal()` therefore always requires an explicit
 * call, gated the same way release.cut is (tier via shared/capabilities.json).
 *
 * RELEASE NOTES: two tiers, so this never blocks on an LLM being configured —
 * a laddered capability per RAMA_AGI_MASTER_SPEC.md section 30 (works at the
 * level that needs nothing, climbs only when a resource is actually present):
 *   L0  structured notes assembled from the proposal itself (kind, title,
 *       summary, changed files, risk, verification score) — always available,
 *       needs no network or credential.
 *   L1  the same facts handed to whatever chat model modelRouter.cjs can
 *       currently reach, asked to explain the change and its significance in
 *       plain language for master to review. Only used if a model is actually
 *       available; on any failure this silently falls back to L0 rather than
 *       blocking the push on an AI call.
 */

const fs   = require('fs');
const path = require('path');
const simpleGit = require('simple-git');

// NOT under data/ — that whole directory is gitignored (encrypted stores,
// per-machine key material). Release notes must actually be committed, so
// they live in a plain tracked directory instead.
const NOTES_DIR = path.join('release-notes');   // relative to repoPath

// ─── Branch naming ────────────────────────────────────────────────────────────
function slugify(s) {
  return String(s || 'change')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'change';
}

function branchNameFor(proposal) {
  const date = new Date().toISOString().slice(0, 10);
  return `self-modify/${date}-${slugify(proposal.title)}-${proposal.id.slice(0, 6)}`;
}

// ─── L0 — structured notes from the proposal itself, no AI needed ───────────
function structuredNotes(proposal) {
  const changedPaths = (proposal.changes || []).map(c => `- \`${c.path}\` (${c.action})`).join('\n') || '- (no file changes recorded)';
  const verification = proposal.meta?.verification;
  const verificationBlock = verification?.ok
    ? `\n**Verification:** ${verification.summary}${verification.totalIssues ? ` — ${verification.totalIssues} issue(s) flagged, see below.` : ''}`
    : verification?.reason
      ? `\n**Verification:** could not run (${verification.reason})`
      : '';

  const issuesBlock = (verification?.files || [])
    .filter(f => f.issues?.length)
    .map(f => `  - \`${f.path}\`: ${f.issues.map(i => `${i.severity} ${i.type}${i.line ? ` (line ${i.line})` : ''}`).join(', ')}`)
    .join('\n');

  return [
    `## ${proposal.title}`,
    '',
    `**Kind:** ${proposal.kind}   **Risk:** ${proposal.risk}   **Requires restart:** ${proposal.requiresRestart ? 'yes' : 'no'}`,
    '',
    `**What changed:** ${proposal.summary || '(no summary provided)'}`,
    '',
    '**Files:**',
    changedPaths,
    verificationBlock,
    issuesBlock ? `\n**Flagged issues:**\n${issuesBlock}` : '',
    '',
    `**Why it matters:** this is an applied, master-approved ${proposal.kind} change (ledger id \`${proposal.id}\`, approved by ${proposal.decidedBy || 'master'}). It lives on its own branch rather than \`dev\`/\`source\` directly — those branches are untouched until this is reviewed and merged, so the previous behaviour stays one \`git checkout dev\` away at all times.`,
  ].filter(Boolean).join('\n');
}

// ─── L1 — optional AI explanation, degrades to L0 on any failure ───────────
async function aiExplainedNotes(proposal, structured) {
  let modelRouter;
  try { modelRouter = require('../ipc/modelRouter.cjs'); }
  catch { return null; }

  const modelId = modelRouter.selectModel('general');
  if (!modelId || !modelRouter.checkAvailable(modelId)) return null;

  const prompt = [
    'You are writing release notes for a desktop AI assistant\'s own self-modification.',
    'Given the structured facts below, write a short explanation (120-200 words) covering:',
    '1) what changed in plain language, 2) why master asked for or approved it,',
    '3) its practical significance — what becomes possible, safer, or fixed.',
    'Do not invent facts not present below. Do not use marketing language.',
    '',
    structured,
  ].join('\n');

  try {
    const res = await modelRouter.chatCompletion(
      [{ role: 'user', content: prompt }],
      modelId
    );
    const text = res?.content?.trim();
    return text ? { text, model: modelId } : null;
  } catch {
    return null;   // never let a model failure block a push
  }
}

/**
 * @param {object} proposal   a proposals.cjs record (must be status APPLIED)
 * @returns {Promise<{ markdown: string, generatedBy: 'ai'|'structured', model?: string }>}
 */
async function generateReleaseNotes(proposal) {
  const structured = structuredNotes(proposal);
  const ai = await aiExplainedNotes(proposal, structured);
  if (ai) {
    return {
      markdown: `${structured}\n\n---\n\n**Explanation (${ai.model}):**\n\n${ai.text}`,
      generatedBy: 'ai',
      model: ai.model,
    };
  }
  return { markdown: structured, generatedBy: 'structured' };
}

// ─── Publish ──────────────────────────────────────────────────────────────────
/**
 * Push an already-applied proposal's changes to a new branch, with release
 * notes committed alongside them.
 *
 * @param {object} opts { repoPath, proposalId, push }
 *   push: if false (default true), the branch and notes are created and
 *   committed locally but not pushed — same "review before it leaves this
 *   machine" pattern as releaseChannel.cjs's Tag Locally / Tag & Push split.
 */
async function publishProposal({ repoPath, proposalId, push = true } = {}) {
  if (!repoPath)   return { ok: false, error: 'repoPath is required' };
  if (!proposalId) return { ok: false, error: 'proposalId is required' };

  const proposals = require('./proposals.cjs');
  const proposal = proposals.get(proposalId);
  if (!proposal) return { ok: false, error: 'Proposal not found' };
  if (proposal.status !== proposals.STATUS.APPLIED) {
    return { ok: false, error: `Proposal is "${proposal.status}" — it must be applied before it can be published` };
  }

  const git = simpleGit(repoPath);

  let startBranch;
  try {
    startBranch = (await git.status()).current;
  } catch (err) {
    return { ok: false, error: `Not a git repo, or git unavailable: ${err.message}` };
  }

  const branch = branchNameFor(proposal);

  const notes = await generateReleaseNotes(proposal);
  const notesRelPath = path.join(NOTES_DIR, `${proposal.id}.md`);
  const notesAbsPath = path.join(repoPath, notesRelPath);

  try {
    // The proposal's own changes are already on disk (apply() already wrote
    // them, per invariant I6 running before this module is ever reached).
    // This function's own write is the release-notes file only.
    fs.mkdirSync(path.dirname(notesAbsPath), { recursive: true });
    fs.writeFileSync(notesAbsPath, notes.markdown, 'utf8');

    await git.checkoutLocalBranch(branch);

    const changedPaths = (proposal.changes || []).map(c => c.path).filter(Boolean);
    await git.add([...changedPaths, notesRelPath]);

    const status = await git.status();
    if (status.files.length === 0) {
      await git.checkout(startBranch);
      return { ok: false, error: 'Nothing to commit — the proposal\'s files matched what is already in git' };
    }

    const commitMsg = `${proposal.kind}(self-modify): ${proposal.title}\n\nProposal ${proposal.id}, approved by ${proposal.decidedBy || 'master'}.\nSee ${notesRelPath} for full release notes.`;
    const commit = await git.commit(commitMsg);

    let pushed = false;
    let pushError = null;
    if (push) {
      try {
        await git.push(['-u', 'origin', branch]);
        pushed = true;
      } catch (err) {
        pushError = err.message;
      }
    }

    // Always return to where we started — publishing must not leave the
    // working tree on the new branch, which would surprise whatever else is
    // reading `dev`/`source` on this machine.
    await git.checkout(startBranch);

    return {
      ok: true,
      branch,
      commit: commit?.commit || null,
      pushed,
      pushError,
      notesPath: notesRelPath,
      releaseNotes: notes.markdown,
      generatedBy: notes.generatedBy,
      note: pushed
        ? `Pushed to origin/${branch}. dev/source are untouched — review and merge when ready. The previous state remains one "git checkout ${startBranch}" away.`
        : pushError
          ? `Committed locally to ${branch}, but push failed: ${pushError}. Push manually when ready.`
          : `Committed locally to ${branch}, not pushed (push:false). Nothing has left this machine yet.`,
    };
  } catch (err) {
    // Best-effort return to the starting branch even on failure, so a half
    // finished publish does not leave the repo checked out somewhere odd.
    try { await git.checkout(startBranch); } catch { /* already reported below */ }
    return { ok: false, error: err.message };
  }
}

// ─── Register IPC ────────────────────────────────────────────────────────────
function register(ipcMain) {
  const capability = require('./capability.cjs');

  ipcMain.handle('publish:preview-notes', async (_e, { proposalId } = {}) => {
    const proposals = require('./proposals.cjs');
    const proposal = proposals.get(proposalId);
    if (!proposal) return { ok: false, error: 'Proposal not found' };
    try {
      const notes = await generateReleaseNotes(proposal);
      return { ok: true, data: notes };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('publish:proposal', async (_e, { user, ...opts } = {}) => {
    // Same gate as release.cut — pushing to the remote is master-only,
    // regardless of how many tiers can approve the underlying proposal.
    if (!capability.can(user, 'release.cut')) {
      const who = capability.TIER_LABELS[String(user?.tier)] ?? 'This account';
      return { ok: false, error: `${who} may not publish a self-modify branch (needs "release.cut")` };
    }
    return publishProposal(opts);
  });
}

module.exports = { register, publishProposal, generateReleaseNotes, branchNameFor };
