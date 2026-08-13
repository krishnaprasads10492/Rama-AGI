'use strict';

/**
 * releaseChannel.cjs — dormant-by-default release cutting.
 *
 * WHAT THIS IS: master asked for the mechanism that lets a code-level
 * self-improvement (an applied SELF_MODIFY/EVOLUTION/RESOURCE proposal) turn
 * into a real new build that every installed copy of Rāma eventually receives
 * — without a CI/CD pipeline existing yet, but without having to redesign
 * anything when one is added later. Design recorded in
 * RAMA_AGI_MASTER_SPEC.md Section 39.
 *
 * HOW IT WORKS TODAY (no CI/CD required):
 *   1. Master reviews what changed since the last tag (git log).
 *   2. Master picks a version bump (patch/minor/major) and writes release
 *      notes.
 *   3. This module bumps `package.json`'s version, prepends a CHANGELOG.md
 *      entry, commits, and creates an annotated git tag `vX.Y.Z`.
 *   4. Master decides whether to push the tag now (`push: true`) or leave it
 *      local to review first. Nothing is pushed without that explicit flag.
 *
 * WHAT HAPPENS IF `.github/workflows/release.yml` IS EVER ENABLED (future,
 * optional — see that file for the workflow itself): pushing a `v*.*.*` tag
 * triggers GitHub Actions to run `vite build` + `electron-builder --publish
 * always` on Windows/macOS/Linux runners and upload the installers to a
 * GitHub Release matching the tag. `main.cjs`'s `autoUpdater` already points
 * at that same repo/provider (`package.json`'s `build.publish`), so every
 * installed copy picks up the new release automatically — no new wiring
 * needed on that side, it already exists (ledger ref: auto-updater setup).
 * Until then, pushing a tag just creates a plain git tag; nothing builds.
 *
 * WHY THIS IS NOT A `proposals.cjs` ENTRY: cutting a release is a MASTER
 * action taken directly (same category as `git.cjs`'s commit/push, which also
 * bypass the ledger) — not Rāma autonomously rewriting its own source. The
 * ledger (I6) gates Rāma's own self-modification; it does not gate master
 * using a tool. What IS gated here is tier: only master may cut a release,
 * enforced via `shared/capabilities.json`'s `release.cut` (tier 0).
 */

const fs   = require('fs');
const path = require('path');
const simpleGit = require('simple-git');

const CHANGELOG_NAME = 'CHANGELOG.md';
const WORKFLOW_PATH  = path.join('.github', 'workflows', 'release.yml');

// ─── Version helpers ─────────────────────────────────────────────────────────
function parseSemver(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(v || '').trim());
  if (!m) return null;
  return { major: +m[1], minor: +m[2], patch: +m[3] };
}

function bumpSemver(v, kind) {
  const s = parseSemver(v) || { major: 1, minor: 0, patch: 0 };
  if (kind === 'major') return `${s.major + 1}.0.0`;
  if (kind === 'minor') return `${s.major}.${s.minor + 1}.0`;
  return `${s.major}.${s.minor}.${s.patch + 1}`;   // default: patch
}

function readPackageJson(repoPath) {
  const p = path.join(repoPath, 'package.json');
  return { path: p, data: JSON.parse(fs.readFileSync(p, 'utf8')) };
}

function writePackageJson(pkgPath, data) {
  fs.writeFileSync(pkgPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function prependChangelog(repoPath, version, notes) {
  const clPath = path.join(repoPath, CHANGELOG_NAME);
  const date   = new Date().toISOString().slice(0, 10);
  const entry  = `## v${version} — ${date}\n\n${notes || '(no notes provided)'}\n\n`;
  const existing = fs.existsSync(clPath) ? fs.readFileSync(clPath, 'utf8') : '# Changelog\n\n';
  const header = existing.startsWith('# Changelog') ? existing : `# Changelog\n\n${existing}`;
  const [firstLine, ...rest] = header.split('\n');
  const body = rest.join('\n').replace(/^\n+/, '');
  fs.writeFileSync(clPath, `${firstLine}\n\n${entry}${body}`, 'utf8');
  return clPath;
}

// ─── State — what a UI needs to decide whether to cut a release ────────────
/**
 * @param {string} repoPath
 * @returns {Promise<object>} version info, tag/commit distance, whether the
 *          dormant workflow file exists, and how many commits sit ahead of
 *          the last tag (nothing here mutates anything).
 */
async function getState(repoPath) {
  const out = {
    version: null,
    lastTag: null,
    commitsSinceTag: null,
    workflowPresent: false,
    workflowActive: 'unknown',   // 'unknown' — we cannot see GitHub Actions status without hitting the API
    remoteConfigured: false,
  };

  try {
    const { data } = readPackageJson(repoPath);
    out.version = data.version || null;
  } catch (err) {
    out.error = `Could not read package.json: ${err.message}`;
    return out;
  }

  out.workflowPresent = fs.existsSync(path.join(repoPath, WORKFLOW_PATH));

  try {
    const git = simpleGit(repoPath);
    const tags = await git.tags();
    out.lastTag = tags.latest || null;
    if (out.lastTag) {
      const log = await git.log({ from: out.lastTag, to: 'HEAD' }).catch(() => ({ total: 0 }));
      out.commitsSinceTag = log.total ?? null;
    }
    const remotes = await git.getRemotes(true);
    out.remoteConfigured = remotes.length > 0;
  } catch (err) {
    out.gitError = err.message;
  }

  return out;
}

// ─── Cut a release ────────────────────────────────────────────────────────────
/**
 * @param {object} opts { repoPath, bump, notes, push }
 * @returns {Promise<object>} { ok, version, tag, pushed, commit }
 */
async function cutRelease({ repoPath, bump = 'patch', notes = '', push = false } = {}) {
  if (!repoPath) return { ok: false, error: 'repoPath is required' };
  if (!['patch', 'minor', 'major'].includes(bump)) {
    return { ok: false, error: `Unknown bump kind: ${bump}` };
  }

  let pkg;
  try {
    pkg = readPackageJson(repoPath);
  } catch (err) {
    return { ok: false, error: `Could not read package.json: ${err.message}` };
  }

  const nextVersion = bumpSemver(pkg.data.version, bump);
  const tag = `v${nextVersion}`;

  const git = simpleGit(repoPath);

  // Refuse to overwrite an existing tag rather than silently reusing it
  const existingTags = await git.tags().catch(() => ({ all: [] }));
  if (existingTags.all?.includes(tag)) {
    return { ok: false, error: `Tag ${tag} already exists — pick a different bump or delete it first` };
  }

  try {
    pkg.data.version = nextVersion;
    writePackageJson(pkg.path, pkg.data);
    prependChangelog(repoPath, nextVersion, notes);

    await git.add(['package.json', CHANGELOG_NAME]);
    const commit = await git.commit(`chore(release): v${nextVersion}`);
    await git.addAnnotatedTag(tag, notes || `Release v${nextVersion}`);

    let pushed = false;
    if (push) {
      const branch = (await git.status()).current;
      await git.push('origin', branch);
      await git.pushTags('origin');
      pushed = true;
    }

    return {
      ok: true,
      version: nextVersion,
      tag,
      pushed,
      commit: commit?.commit || null,
      note: pushed
        ? (fs.existsSync(path.join(repoPath, WORKFLOW_PATH))
            ? `Tag ${tag} pushed. If .github/workflows/release.yml is enabled on GitHub, a build will start now.`
            : `Tag ${tag} pushed. No CI/CD is configured yet — nothing will build automatically until the workflow is enabled.`)
        : `Tag ${tag} created locally. Push it (git push origin ${tag}) or re-run with push:true when ready.`,
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ─── Register IPC ────────────────────────────────────────────────────────────
function register(ipcMain) {
  const capability = require('./capability.cjs');

  ipcMain.handle('release:state', async (_e, { repoPath } = {}) => {
    if (!repoPath) return { ok: false, error: 'repoPath is required' };
    return { ok: true, data: await getState(repoPath) };
  });

  ipcMain.handle('release:cut', async (_e, { user, ...opts } = {}) => {
    // Master-only: this writes package.json/CHANGELOG.md, commits, tags, and
    // can push — the same class of action as a git push, gated the same way.
    if (!capability.can(user, 'release.cut')) {
      const who = capability.TIER_LABELS[String(user?.tier)] ?? 'This account';
      return { ok: false, error: `${who} may not cut a release (needs "release.cut")` };
    }
    return cutRelease(opts);
  });
}

module.exports = { register, getState, cutRelease, bumpSemver };
