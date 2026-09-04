'use strict';

/**
 * updateChannel.cjs — a folder that an installed Rāma can update itself from (spec Section 84).
 *
 * Master's request: a folder that a post-build step pushes the latest build into, which an
 * already-installed app can read as an update source.
 *
 * This is a release channel with a filesystem as its transport. It has one publisher (a build) and
 * any number of readers (installs). It needs no GitHub, no code signing decision, no network, and
 * it works across machines if the folder is on a share or a synced drive.
 *
 * ─── SECURITY, STATED BEFORE THE FEATURES ────────────────────────────────────
 *
 * APPLYING AN UPDATE FROM THIS CHANNEL RUNS AN EXECUTABLE FROM THAT FOLDER. The SHA-256 in the
 * manifest gives INTEGRITY — it proves the installer is the file the manifest describes and was not
 * truncated or corrupted in transit. It does NOT give AUTHENTICITY: anyone who can write the
 * installer can also rewrite the manifest, hash included. So the honest statement is:
 *
 *     whoever can write to the channel folder can make Rāma run their executable.
 *
 * Therefore: point it only at a folder under master's control, never a world-writable or
 * publicly-shared location. Authenticity needs code signing, which is a decision master has not
 * made (ledger row 53), and pretending a hash substitutes for it would be the dangerous lie here.
 * The UI says this too — it is not buried in a comment.
 *
 * Nothing is ever applied automatically. No startup check installs anything. Applying is a
 * separate, master-only action, for the same reason Section 83 split build from install.
 *
 * ─── NOT DIFFERENTIAL ────────────────────────────────────────────────────────
 *
 * Master asked for "latest/diff build". This publishes the WHOLE installer, not a binary delta.
 * Real differential updates need electron-builder's `.blockmap` plus electron-updater to consume
 * it, and electron-updater's generic provider over a `file://` URL is unreliable and additionally
 * wants a signed build to verify. Copying ~100 MB locally costs a second; a delta mechanism that
 * silently half-works would cost a broken install. Said plainly rather than implied by the word
 * "channel".
 *
 * ─── TESTABILITY ─────────────────────────────────────────────────────────────
 *
 * This module never requires `electron`. The userData path is injected, exactly as Section 80 does
 * for `packaged`/`appPath`, so every rule here can be tested under plain node.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const MANIFEST_NAME = 'latest.json';
const MANIFEST_VERSION = 1;
const DEFAULT_SUBDIR = 'update-channel';
const INSTALLER_RE = /\.exe$/i;
const PORTABLE_RE = /\.(zip|7z)$/i;
const KEEP_DEFAULT = 3;

/**
 * Where the channel lives.
 *
 * `RAMA_UPDATE_CHANNEL_DIR` wins, because the whole point is that master can put this on a network
 * share or a synced folder and update several machines from one build. Otherwise it sits under
 * userData, which is OUTSIDE the app directory — so it survives the very reinstall it performs, and
 * an uninstall does not take the channel with it (`nsis.deleteAppDataOnUninstall` is false).
 */
function channelDir({ userDataPath = null, override = null } = {}) {
  const env = process.env.RAMA_UPDATE_CHANNEL_DIR;
  const chosen = override || env || (userDataPath ? path.join(userDataPath, DEFAULT_SUBDIR) : null);
  if (!chosen) return null;
  return path.resolve(chosen);
}

/**
 * Compare two dotted versions. Returns -1, 0 or 1.
 *
 * WRITTEN HERE RATHER THAN PULLED FROM `semver`. `semver` is present in node_modules only as a
 * transitive dependency of electron-builder, and this comparison decides whether master installs
 * something — depending on a package nobody declared is how a working check disappears during an
 * unrelated install (the same lesson as Section 81's Babel imports). It is fifteen lines and it is
 * tested.
 *
 * A pre-release suffix (`1.0.1-beta.2`) is ordered BELOW the same release (`1.0.1`), which is the
 * semver rule, and compared lexically among themselves. Missing parts count as zero, so `1.1` and
 * `1.1.0` are equal.
 */
function compareVersions(a, b) {
  const parse = (v) => {
    const s = String(v ?? '').trim().replace(/^v/i, '');
    const [core, pre = ''] = s.split('-', 2);
    const nums = core.split('.').map((n) => {
      const i = parseInt(n, 10);
      return Number.isFinite(i) ? i : 0;
    });
    return { nums, pre };
  };
  const A = parse(a);
  const B = parse(b);
  const len = Math.max(A.nums.length, B.nums.length);
  for (let i = 0; i < len; i++) {
    const x = A.nums[i] ?? 0;
    const y = B.nums[i] ?? 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  if (A.pre === B.pre) return 0;
  if (!A.pre) return 1;      // a release outranks a pre-release of the same core
  if (!B.pre) return -1;
  return A.pre > B.pre ? 1 : -1;
}

function sha256(file) {
  const h = crypto.createHash('sha256');
  h.update(fs.readFileSync(file));
  return h.digest('hex');
}

/**
 * Replace `target` with `tmp` atomically enough for Windows.
 *
 * FOUND BY THE TEST, NOT BY REVIEW. `fs.renameSync` over an EXISTING file threw
 * `EPERM: operation not permitted, rename ... latest.json.part -> latest.json` on the second
 * publish. It maps to `MoveFileExW` with replace-existing, so it should overwrite — but on Windows
 * a transient handle from an indexer or antivirus on the file just written is enough to refuse it.
 *
 * This is the identical failure class `outcomes.py` already documents for `os.replace` (Section 68):
 * a platform difference, not a logic error, and a brief backoff is the normal remedy. Unlinking the
 * target first narrows the window rather than widening it — the temporary file is already complete
 * on disk, so the worst case is a missing manifest for a few milliseconds, which `readManifest`
 * reports as "no latest.json" rather than misreading.
 */
function atomicReplace(tmp, target, attempts = 6) {
  let last = null;
  for (let i = 0; i < attempts; i++) {
    try {
      fs.renameSync(tmp, target);
      return;
    } catch (err) {
      last = err;
      if (!['EPERM', 'EACCES', 'EBUSY', 'EEXIST'].includes(err.code)) throw err;
      try { if (fs.existsSync(target)) fs.unlinkSync(target); } catch { /* try again below */ }
      // Synchronous backoff: this runs in the main process and the waits are milliseconds.
      const until = Date.now() + 20 * (i + 1);
      while (Date.now() < until) { /* spin briefly */ }
    }
  }
  throw last;
}

/**
 * Validate a manifest read from disk.
 *
 * A manifest is untrusted input — it may be hand-edited, half-written by a crashed copy, or from a
 * future version of Rāma. `file` is required to be a bare name so a manifest can never point the
 * installer launcher outside the channel directory.
 */
function validateManifest(raw) {
  const problems = [];
  if (!raw || typeof raw !== 'object') return { ok: false, problems: ['not a JSON object'] };
  if (typeof raw.version !== 'string' || !raw.version.trim()) problems.push('missing version');
  if (typeof raw.file !== 'string' || !raw.file.trim()) problems.push('missing file');
  else if (raw.file !== path.basename(raw.file)) problems.push('file must be a bare filename');
  else if (!INSTALLER_RE.test(raw.file) && !PORTABLE_RE.test(raw.file)) {
    problems.push(`file is neither an installer nor an archive: ${raw.file}`);
  }
  if (typeof raw.sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(raw.sha256 || '')) {
    problems.push('missing or malformed sha256');
  }
  if (raw.manifestVersion != null && Number(raw.manifestVersion) > MANIFEST_VERSION) {
    problems.push(`manifest version ${raw.manifestVersion} is newer than this app understands `
      + `(${MANIFEST_VERSION}) — update from the installer by hand`);
  }
  return { ok: problems.length === 0, problems };
}

function readManifest(dir) {
  if (!dir) return { ok: false, error: 'no channel directory configured' };
  const file = path.join(dir, MANIFEST_NAME);
  if (!fs.existsSync(file)) {
    return { ok: false, empty: true, error: `no ${MANIFEST_NAME} in ${dir}` };
  }
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    return { ok: false, error: `${MANIFEST_NAME} is not readable JSON: ${err.message}` };
  }
  const v = validateManifest(raw);
  if (!v.ok) return { ok: false, error: `${MANIFEST_NAME} is invalid: ${v.problems.join('; ')}` };
  return { ok: true, manifest: raw };
}

/**
 * What the channel is offering, relative to what is installed.
 *
 * `verified` is only true once the file on disk hashes to what the manifest claims — a partially
 * copied installer is the most likely real-world failure, and it would otherwise be offered as a
 * valid update and then fail halfway through installing.
 */
function status({ dir, currentVersion } = {}) {
  const out = {
    dir: dir || null,
    currentVersion: currentVersion || null,
    available: false,
    upToDate: false,
    manifest: null,
    verified: false,
    canApply: false,
    kind: null,
    reason: null,
    warning: 'Applying an update runs an executable from this folder. The hash proves integrity, '
      + 'not authorship — anyone who can write here can change both the file and its hash. Point '
      + 'this only at a folder you control.',
  };
  const read = readManifest(dir);
  if (!read.ok) {
    out.reason = read.error;
    return out;
  }
  const m = read.manifest;
  out.manifest = m;
  out.kind = INSTALLER_RE.test(m.file) ? 'installer' : 'portable';

  const cmp = currentVersion ? compareVersions(m.version, currentVersion) : 1;
  if (cmp <= 0) {
    out.upToDate = true;
    out.reason = cmp === 0
      ? `the channel holds ${m.version}, which is what is installed`
      : `the channel holds ${m.version}, older than the installed ${currentVersion}`;
    return out;
  }

  const artefact = path.join(dir, m.file);
  if (!fs.existsSync(artefact)) {
    out.reason = `${MANIFEST_NAME} names ${m.file} but that file is not in the folder`;
    return out;
  }

  let actual;
  try {
    actual = sha256(artefact);
  } catch (err) {
    out.reason = `could not hash ${m.file}: ${err.message}`;
    return out;
  }
  if (actual.toLowerCase() !== String(m.sha256).toLowerCase()) {
    out.reason = `${m.file} does not match the hash in ${MANIFEST_NAME} — it is corrupt, still `
      + 'being copied, or was replaced. Not offering it.';
    return out;
  }

  out.available = true;
  out.verified = true;
  // A portable archive cannot replace an installed app, so it is reported but not applied.
  out.canApply = out.kind === 'installer';
  out.reason = out.canApply
    ? `${m.version} is available and its hash matches`
    : `${m.version} is available, but as a ${out.kind} archive — extract and run it manually; `
      + 'Rāma cannot replace an installed copy from an archive';
  return out;
}

/**
 * Copy a built artefact into the channel and write the manifest.
 *
 * THE MANIFEST IS WRITTEN LAST, AND VIA A TEMPORARY FILE. A reader that arrives mid-publish must
 * either see the old manifest or the new one, never a half-written one pointing at a half-copied
 * installer. The artefact is likewise copied to a `.part` name and renamed, so the name in the
 * manifest never exists until it is complete.
 */
function publish({ artefactPath, dir, version, notes = null, keep = KEEP_DEFAULT,
  product = 'Rama AGI' } = {}) {
  if (!artefactPath) return { ok: false, error: 'artefactPath is required' };
  if (!dir) return { ok: false, error: 'no channel directory configured' };
  if (!fs.existsSync(artefactPath)) {
    return { ok: false, error: `not found: ${artefactPath}` };
  }
  const name = path.basename(artefactPath);
  if (!INSTALLER_RE.test(name) && !PORTABLE_RE.test(name)) {
    return { ok: false, error: `${name} is neither an installer nor an archive` };
  }
  if (!version) return { ok: false, error: 'version is required' };

  try {
    fs.mkdirSync(dir, { recursive: true });
    const target = path.join(dir, name);
    const part = `${target}.part`;
    fs.copyFileSync(artefactPath, part);
    atomicReplace(part, target);

    const manifest = {
      manifestVersion: MANIFEST_VERSION,
      product,
      version: String(version),
      file: name,
      sha256: sha256(target),
      sizeBytes: fs.statSync(target).size,
      kind: INSTALLER_RE.test(name) ? 'installer' : 'portable',
      builtAt: new Date().toISOString(),
      notes: notes || null,
    };
    const mPath = path.join(dir, MANIFEST_NAME);
    const mPart = `${mPath}.part`;
    fs.writeFileSync(mPart, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    atomicReplace(mPart, mPath);

    const pruned = prune({ dir, keep, protect: name });
    return { ok: true, dir, manifest, pruned };
  } catch (err) {
    return { ok: false, error: `publish failed: ${err.message}` };
  }
}

/**
 * Keep the channel from growing without limit.
 *
 * The file the current manifest points at is never removed, however old it looks — pruning the
 * artefact out from under a live manifest would leave every reader with a broken update.
 */
function prune({ dir, keep = KEEP_DEFAULT, protect = null } = {}) {
  const removed = [];
  if (!dir || !fs.existsSync(dir)) return removed;
  const files = [];
  for (const name of fs.readdirSync(dir)) {
    if (name === MANIFEST_NAME || name.endsWith('.part')) continue;
    if (!INSTALLER_RE.test(name) && !PORTABLE_RE.test(name)) continue;
    try {
      files.push({ name, mtimeMs: fs.statSync(path.join(dir, name)).mtimeMs });
    } catch { /* vanished */ }
  }
  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const limit = Math.max(1, Number(keep) || KEEP_DEFAULT);
  for (const f of files.slice(limit)) {
    if (protect && f.name === protect) continue;
    try {
      fs.unlinkSync(path.join(dir, f.name));
      removed.push(f.name);
    } catch { /* leave it */ }
  }
  return removed;
}

/**
 * Run the channel's installer. Re-verifies the hash immediately before spawning.
 *
 * The gap between checking and running is where a swap would land, so the check happens here too
 * rather than trusting the earlier `status()` call.
 */
function apply({ dir } = {}) {
  const st = status({ dir, currentVersion: null });
  if (!st.manifest) return { ok: false, error: st.reason || 'nothing to apply' };
  if (!st.verified) return { ok: false, error: st.reason || 'the artefact did not verify' };
  if (st.kind !== 'installer') {
    return { ok: false, error: 'the channel holds an archive, not an installer — Rāma cannot '
      + 'replace an installed copy from it' };
  }
  const full = path.join(dir, st.manifest.file);
  try {
    const child = spawn(full, [], { detached: true, stdio: 'ignore', cwd: dir });
    child.unref();
    return {
      ok: true,
      launching: true,
      version: st.manifest.version,
      installer: full,
      message: `Installer for ${st.manifest.version} is starting. Rāma will close so Windows can `
        + 'replace the files. Reopen it when the installer finishes.',
    };
  } catch (err) {
    return { ok: false, error: `could not start the installer: ${err.message}` };
  }
}

module.exports = {
  channelDir, compareVersions, validateManifest, readManifest, status, publish, prune, apply,
  sha256, MANIFEST_NAME, MANIFEST_VERSION,
};

