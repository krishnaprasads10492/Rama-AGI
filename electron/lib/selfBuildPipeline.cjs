'use strict';

/**
 * selfBuildPipeline.cjs — Rāma builds its own next version, then hands it over (spec Section 83).
 *
 * Master asked for "its own pipeline built in which will run the build and assimilate into the old
 * build". This is that, with one hard constraint stated up front:
 *
 * A PACKAGED WINDOWS APP CANNOT OVERWRITE ITS OWN RUNNING EXECUTABLE. Windows holds a lock on
 * `Rama AGI.exe` and on the loaded `app.asar` for as long as the process lives. That is not a gap
 * in Rāma — it is why `electron-updater` exists and why every desktop updater ends with "restart to
 * finish". So "assimilate into the old build" cannot mean editing the install in place. What it can
 * mean, and what this does:
 *
 *     build the next version  ->  verify the artefact  ->  hand the installer to Windows
 *     ->  quit so it can replace the files  ->  master reopens an updated app
 *
 * The install itself is done by the NSIS installer that `scripts/buildInstaller.cjs` already
 * produces, over the top of the existing one. Master's data lives outside the app directory, so it
 * is untouched.
 *
 * WHY THIS DOES NOT REIMPLEMENT THE BUILD. `scripts/buildInstaller.cjs` is already the pipeline:
 * toolchain check, dependency ladder, `vite build`, archiver resolution, `electron-builder`, and a
 * post-build load check of the artefact itself (Section 45/48). Duplicating any of that here would
 * create a second definition of "a correct build" that could drift from the one master runs by
 * hand. This module runs it and interprets the result.
 *
 * WHY IT IS SEPARATE FROM `localUpdateEngine.cjs`. That module updates a SOURCE CHECKOUT in place —
 * pull, install, rebuild the renderer, reload. It is the right tool when Rāma runs from a clone.
 * This module produces an INSTALLABLE ARTEFACT for a packaged install, which is a different
 * outcome. Section 80 established that the two cases are genuinely different; this is the other
 * half of that answer.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const OUTPUT_DIR = 'dist-electron';

// Anything matching this in the output directory is something Windows can run to install.
const INSTALLER_RE = /\.exe$/i;
const PORTABLE_RE = /\.(zip|7z)$/i;

function runStreamed(cmd, args, opts, onLog) {
  return new Promise((resolve) => {
    let proc;
    try {
      proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: false, ...opts });
    } catch (err) {
      resolve({ ok: false, error: err.message, out: '' });
      return;
    }
    let out = '';
    const take = (d) => { const s = String(d); out += s; onLog?.(s); };
    proc.stdout?.on('data', take);
    proc.stderr?.on('data', take);
    proc.on('error', (err) => resolve({ ok: false, error: err.message, out }));
    proc.on('close', (code) => resolve({ ok: code === 0, code, out }));
  });
}

/**
 * Which files in the output directory were produced by THIS run?
 *
 * THE DANGEROUS FAILURE THIS PREVENTS. `dist-electron/` accumulates. A previous run — including a
 * FAILED one that salvaged a portable zip — leaves artefacts behind. If the pipeline reported
 * "build complete" and then handed master the newest-looking `.exe` on disk, a build that actually
 * failed would install an OLDER version and look like it had worked. Nothing downstream could
 * detect that. So freshness is decided by mtime against the moment the build started, and anything
 * older is reported as stale and never offered for install.
 *
 * Exported and pure so it can be tested without running a real build.
 */
function classifyArtifacts(entries, startedAt) {
  const fresh = [];
  const stale = [];
  for (const e of entries || []) {
    const isInstaller = INSTALLER_RE.test(e.name);
    const isPortable = PORTABLE_RE.test(e.name);
    const isUnpacked = !!e.isDirectory && e.name.endsWith('-unpacked');
    if (!isInstaller && !isPortable && !isUnpacked) continue;
    const item = {
      name: e.name,
      sizeMB: typeof e.size === 'number' ? Math.round((e.size / 1048576) * 10) / 10 : null,
      kind: isInstaller ? 'installer' : isPortable ? 'portable' : 'unpacked',
      mtimeMs: e.mtimeMs,
    };
    if (typeof e.mtimeMs === 'number' && e.mtimeMs >= startedAt) fresh.push(item);
    else stale.push(item);
  }
  const byNewest = (a, b) => (b.mtimeMs || 0) - (a.mtimeMs || 0);
  fresh.sort(byNewest);
  stale.sort(byNewest);
  return {
    fresh,
    stale,
    // Only ever an artefact this run produced.
    installer: fresh.find((a) => a.kind === 'installer') || null,
    portable: fresh.find((a) => a.kind === 'portable') || null,
  };
}

function readOutputDir(repoPath) {
  const dir = path.join(repoPath, OUTPUT_DIR);
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    try {
      const st = fs.statSync(path.join(dir, name));
      out.push({
        name,
        size: st.size,
        mtimeMs: st.mtimeMs,
        isDirectory: st.isDirectory(),
      });
    } catch { /* vanished mid-scan */ }
  }
  return out;
}

/**
 * Build the next version.
 *
 * @param {object} opts { repoPath, onLog, pull, packaged, appPath }
 * @returns {Promise<object>} what was produced, and whether it can be installed
 */
async function build({ repoPath, onLog = () => {}, pull = false } = {}) {
  if (!repoPath) return { ok: false, error: 'repoPath is required' };
  if (!fs.existsSync(path.join(repoPath, 'package.json'))) {
    return { ok: false, error: `${repoPath} does not look like the Rāma source (no package.json)` };
  }
  const script = path.join(repoPath, 'scripts', 'buildInstaller.cjs');
  if (!fs.existsSync(script)) {
    return { ok: false, error: `the build script is missing at ${script}` };
  }

  const startedAt = Date.now();

  if (pull) {
    onLog('Pulling the tracked branch before building...\n');
    const simpleGit = require('simple-git');
    try {
      const git = simpleGit(repoPath);
      const status = await git.status();
      if (!status.isClean()) {
        return {
          ok: false,
          error: 'the source tree has uncommitted changes — commit or stash them before a '
            + 'build-and-install, so the version you install is one that exists in git',
        };
      }
      await git.pull();
    } catch (err) {
      return { ok: false, error: `git pull failed: ${err.message}` };
    }
  }

  onLog(`Building with ${path.relative(repoPath, script)}...\n`);
  onLog('This runs the same pipeline as `npm run package:win` — dependency ladder, renderer '
    + 'build, packaging, then a load check of the artefact itself.\n\n');

  // `process.execPath` is Electron's own binary here, and running a build script under it would
  // give the script an Electron runtime rather than Node. `node` from PATH is what the script
  // expects and what master would use by hand.
  const res = await runStreamed('node', [script], { cwd: repoPath }, onLog);

  const scan = classifyArtifacts(readOutputDir(repoPath), startedAt);
  const durationMs = Date.now() - startedAt;

  if (!res.ok) {
    return {
      ok: false,
      error: `the build failed (exit ${res.code ?? '?'})`
        + (scan.fresh.length ? ' — some output was produced but must not be installed' : ''),
      durationMs,
      ...scan,
      installer: null,   // never offer an install from a failed build
      portable: null,
    };
  }

  if (scan.fresh.length === 0) {
    return {
      ok: false,
      error: 'the build reported success but produced no new artefacts in '
        + `${OUTPUT_DIR}/ — nothing to install`,
      durationMs,
      ...scan,
    };
  }

  return {
    ok: true,
    durationMs,
    outputDir: path.join(repoPath, OUTPUT_DIR),
    ...scan,
    // Said plainly, because the fallback is easy to mistake for success. Section 45: on a machine
    // where endpoint policy blocks 7-Zip, electron-builder cannot make an NSIS installer and the
    // run salvages an unpacked tree plus a portable zip instead.
    canInstallInPlace: !!scan.installer,
    note: scan.installer
      ? 'An installer was produced. Applying it closes Rāma so Windows can replace the files.'
      : 'No installer was produced — only a portable/unpacked build, which is what happens when '
        + '7-Zip is blocked on this machine (Section 45). Rāma cannot replace itself from that; '
        + 'unzip it and run the executable inside, or build on a machine that can reach 7-Zip.',
  };
}

/**
 * Hand the installer to Windows and get out of its way.
 *
 * SEPARATE FROM `build()` ON PURPOSE. This quits the application. Bundling it into the build would
 * mean a single click both compiles for minutes and then closes Rāma, and master would have no
 * moment in between to read what was produced or change his mind. The caller decides.
 *
 * @returns {Promise<object>} `{ok:true, launching:true}` means the caller should now quit.
 */
async function launchInstaller({ repoPath, fileName } = {}) {
  if (!repoPath || !fileName) return { ok: false, error: 'repoPath and fileName are required' };
  // Refuse a path rather than a bare name: this spawns an executable, so it must not be
  // steerable outside the build output directory.
  if (fileName !== path.basename(fileName)) {
    return { ok: false, error: 'fileName must be a bare file name inside the build output' };
  }
  if (!INSTALLER_RE.test(fileName)) {
    return { ok: false, error: `${fileName} is not an installer executable` };
  }
  const full = path.join(repoPath, OUTPUT_DIR, fileName);
  if (!fs.existsSync(full)) return { ok: false, error: `not found: ${full}` };

  try {
    // Detached and unref'd so the installer outlives the process that started it — otherwise
    // quitting Rāma would kill the thing meant to replace Rāma.
    const child = spawn(full, [], {
      detached: true,
      stdio: 'ignore',
      cwd: path.join(repoPath, OUTPUT_DIR),
    });
    child.unref();
    return {
      ok: true,
      launching: true,
      installer: full,
      message: 'The installer is starting. Rāma will close so it can replace the files. '
        + 'Reopen Rāma when the installer finishes.',
    };
  } catch (err) {
    return { ok: false, error: `could not start the installer: ${err.message}` };
  }
}

/**
 * Bump a dotted version. Pure, so it is tested rather than trusted.
 *
 * WHY THE RELEASE BUTTON MUST DO THIS. Publishing without a bump produces an artefact whose version
 * equals what is already installed everywhere, and `updateChannel.status()` correctly reports every
 * install as up to date. The build would succeed, the publish would succeed, and NOTHING would be
 * offered to anybody — a silent no-op that looks like a working release. So versioning is part of
 * the one-click flow, not something master has to remember first.
 */
function bumpVersion(current, kind = 'patch') {
  const s = String(current ?? '0.0.0').trim().replace(/^v/i, '');
  const [core] = s.split('-', 1);
  const parts = core.split('.').map((n) => {
    const i = parseInt(n, 10);
    return Number.isFinite(i) && i >= 0 ? i : 0;
  });
  while (parts.length < 3) parts.push(0);
  const [maj, min, pat] = parts;
  if (kind === 'none') return core.split('.').length >= 3 ? core : `${maj}.${min}.${pat}`;
  if (kind === 'major') return `${maj + 1}.0.0`;
  if (kind === 'minor') return `${maj}.${min + 1}.0`;
  return `${maj}.${min}.${pat + 1}`;
}

/**
 * ONE ACTION: bump → pull → build → verify → publish → prune → report.
 *
 * Master asked for a single button that does everything. The steps were already here as separate
 * calls (Sections 83 and 84) and stitching them together in the renderer would have put the
 * ordering — and the failure handling — in the UI, where it cannot be tested. This composes them in
 * the main process instead, and the renderer gets one call and one result.
 *
 * THE ORDER MATTERS AND IS NOT ARBITRARY:
 *   1. pull first, so the build includes whatever was pushed from elsewhere
 *   2. bump AFTER the pull, or the pull would conflict with a locally-bumped package.json
 *   3. build, which is also the verification step (`buildInstaller.cjs` load-checks the artefact)
 *   4. publish only on a clean build — a failed build must never reach the channel
 *   5. prune last, once the new release is live, so a reader is never left with nothing
 *
 * Each step reports rather than throwing, so a failure at step 4 still tells master that steps 1–3
 * succeeded and the artefact is on disk.
 */
async function release({ repoPath, bump = 'patch', pull = true, commitBump = true,
  channelDir = null, notes = null, keep = null, onLog = () => {} } = {}) {
  const fsx = require('fs');
  const started = Date.now();
  const steps = [];
  const step = (name, ok, detail) => {
    steps.push({ name, ok, detail: detail || null });
    onLog(`${ok ? '✓' : '✕'} ${name}${detail ? ` — ${detail}` : ''}\n`);
  };

  if (!repoPath) return { ok: false, error: 'repoPath is required', steps };
  const pkgPath = path.join(repoPath, 'package.json');
  if (!fsx.existsSync(pkgPath)) {
    return { ok: false, error: `${repoPath} is not the Rāma source (no package.json)`, steps };
  }

  const simpleGit = require('simple-git');
  const git = simpleGit(repoPath);
  const channel = require('./updateChannel.cjs');

  // ── 1. Pull ───────────────────────────────────────────────────────────────
  if (pull) {
    try {
      const status = await git.status();
      if (!status.isClean()) {
        // Refusing here rather than forcing: a release built from uncommitted work is a version
        // that exists nowhere in git, so it could never be reproduced or rolled back to.
        return {
          ok: false,
          error: 'the source tree has uncommitted changes. A release must be built from committed '
            + 'code, or the version you install exists nowhere in git. Commit or stash first.',
          dirty: status.files.map((f) => f.path).slice(0, 20),
          steps,
        };
      }
      await git.pull();
      step('pulled the tracked branch');
    } catch (err) {
      step('pull', false, err.message);
      return { ok: false, error: `git pull failed: ${err.message}`, steps };
    }
  }

  // ── 2. Bump ───────────────────────────────────────────────────────────────
  let pkg;
  try {
    pkg = JSON.parse(fsx.readFileSync(pkgPath, 'utf8'));
  } catch (err) {
    return { ok: false, error: `package.json is unreadable: ${err.message}`, steps };
  }
  const fromVersion = pkg.version;
  const toVersion = bumpVersion(fromVersion, bump);

  if (bump !== 'none' && toVersion !== fromVersion) {
    try {
      pkg.version = toVersion;
      // Two-space JSON with a trailing newline, matching what npm itself writes, so the diff is
      // one line rather than the whole file reformatted.
      fsx.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
      step(`version ${fromVersion} → ${toVersion}`);
    } catch (err) {
      step('version bump', false, err.message);
      return { ok: false, error: `could not write package.json: ${err.message}`, steps };
    }

    if (commitBump) {
      try {
        await git.add(['package.json']);
        await git.commit(`chore(release): v${toVersion}`);
        step(`committed chore(release): v${toVersion}`);
      } catch (err) {
        // Not fatal. The bump is on disk and the build will use it; master just has an uncommitted
        // package.json to deal with, and is told so rather than left to discover it.
        step('commit the bump', false,
          `${err.message} — package.json is bumped but NOT committed`);
      }
    }
  } else {
    step(`version stays ${fromVersion}`, true,
      bump === 'none'
        ? 'no bump requested — installs already on this version will not be offered anything'
        : null);
  }

  // ── 3. Build ──────────────────────────────────────────────────────────────
  const built = await build({ repoPath, pull: false, onLog });
  if (!built.ok) {
    step('build', false, built.error);
    return {
      ok: false, error: built.error, version: toVersion, built, steps,
      durationMs: Date.now() - started,
    };
  }
  step('built and load-checked the artefact',
    built.installer ? built.installer.name : built.portable?.name);

  // ── 4. Publish ────────────────────────────────────────────────────────────
  const artefact = built.installer || built.portable;
  const dir = channel.channelDir({ override: channelDir || null })
    || path.join(repoPath, OUTPUT_DIR, 'channel');
  const published = channel.publish({
    artefactPath: path.join(built.outputDir, artefact.name),
    dir,
    version: toVersion,
    product: pkg.build?.productName || pkg.name,
    notes: notes || null,
    keep: keep == null ? undefined : Number(keep),
  });
  if (!published.ok) {
    step('publish', false, published.error);
    return {
      ok: false, error: published.error, version: toVersion, built, steps,
      durationMs: Date.now() - started,
    };
  }
  step(`published to ${dir}`,
    `${published.manifest.file} (${(published.manifest.sizeBytes / 1048576).toFixed(1)} MB)`);
  if (published.pruned.length) {
    step('removed superseded builds', true, published.pruned.join(', '));
  }

  return {
    ok: true,
    fromVersion,
    version: toVersion,
    channelDir: dir,
    manifest: published.manifest,
    pruned: published.pruned,
    installer: built.installer,
    portable: built.portable,
    canInstall: !!built.installer,
    steps,
    durationMs: Date.now() - started,
    note: built.installer
      ? 'Any install pointed at this folder — including one still on an older version — is now '
        + 'offered this build, and can upgrade to it directly because it is a full installer '
        + 'rather than a patch.'
      : built.portable
        ? 'Only a portable archive was produced (7-Zip blocked, Section 45), so installs can see '
          + 'this release but cannot self-upgrade to it. Extract and run it by hand.'
        : null,
  };
}

module.exports = { build, release, bumpVersion, launchInstaller, classifyArtifacts, OUTPUT_DIR };
