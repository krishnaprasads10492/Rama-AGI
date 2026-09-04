#!/usr/bin/env node
'use strict';

/**
 * verifySelfBuild.cjs — the pipeline must never hand master a stale installer (Section 83).
 *
 * THE FAILURE THIS EXISTS TO PREVENT. `dist-electron/` accumulates. A previous run — including a
 * FAILED one that salvaged a portable zip — leaves artefacts behind. If the pipeline reported
 * "build complete" and then offered the newest-looking `.exe` on disk, a build that had actually
 * failed would install an OLDER version and look like it had worked. Nothing downstream could
 * detect that: the installer would run, the app would start, and it would silently be the previous
 * build. That is the worst possible outcome for an update mechanism, so the selection rule is
 * tested rather than reviewed.
 *
 * `classifyArtifacts` is pure — it takes directory entries and a start timestamp — so this runs
 * without building anything.
 *
 * Run: node scripts/verifySelfBuild.cjs   (or npm run verify:build)
 */

const pipeline = require('../electron/lib/selfBuildPipeline.cjs');

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

const { classifyArtifacts, launchInstaller } = pipeline;

const START = 1_000_000;
const entry = (name, mtimeMs, over = {}) => ({
  name, mtimeMs, size: 50 * 1048576, isDirectory: false, ...over,
});

// ── Freshness is the whole point ─────────────────────────────────────────────
console.log('\n--- THE DANGEROUS CASE: a stale installer must never be offered ---');

const mixed = classifyArtifacts([
  entry('Rama-AGI-Setup-1.0.0.exe', START - 60_000),      // left over from a previous run
  entry('Rama-AGI-1.0.0-portable.zip', START + 5_000),    // produced now
], START);

check('an installer older than the build start is classified stale',
  mixed.stale.some(a => a.name.endsWith('.exe')), JSON.stringify(mixed.stale));
check('AND IS NOT OFFERED AS THE INSTALLER', mixed.installer === null,
  JSON.stringify(mixed.installer));
check('the freshly produced portable IS recognised',
  mixed.portable?.name === 'Rama-AGI-1.0.0-portable.zip', JSON.stringify(mixed.portable));
check('stale entries are still reported rather than hidden', mixed.stale.length === 1);

const fresh = classifyArtifacts([
  entry('Rama-AGI-Setup-1.0.0.exe', START + 10_000),
], START);
check('an installer produced by this run IS offered',
  fresh.installer?.name === 'Rama-AGI-Setup-1.0.0.exe', JSON.stringify(fresh.installer));
check('and is not listed as stale', fresh.stale.length === 0);

const exactly = classifyArtifacts([entry('Setup.exe', START)], START);
check('an artefact stamped exactly at the start counts as fresh, not stale',
  exactly.installer !== null, JSON.stringify(exactly));

// ── Newest wins among several fresh ones ────────────────────────────────────
console.log('\n--- picking among several ---');

const several = classifyArtifacts([
  entry('Rama-AGI-Setup-0.9.9.exe', START + 1_000),
  entry('Rama-AGI-Setup-1.0.0.exe', START + 9_000),
], START);
check('the newest fresh installer is chosen',
  several.installer?.name === 'Rama-AGI-Setup-1.0.0.exe', JSON.stringify(several.installer));
check('both are listed as fresh', several.fresh.length === 2);

// ── What counts as an artefact ──────────────────────────────────────────────
console.log('\n--- what counts, and what does not ---');

const kinds = classifyArtifacts([
  entry('Setup.exe', START + 1),
  entry('portable.zip', START + 1),
  entry('bundle.7z', START + 1),
  entry('win-unpacked', START + 1, { isDirectory: true }),
  entry('builder-effective-config.yaml', START + 1),
  entry('latest.yml', START + 1),
  entry('.icon-ico', START + 1, { isDirectory: true }),
], START);
const names = kinds.fresh.map(a => a.name);
check('an .exe counts as an installer',
  kinds.fresh.find(a => a.name === 'Setup.exe')?.kind === 'installer');
check('a .zip counts as portable',
  kinds.fresh.find(a => a.name === 'portable.zip')?.kind === 'portable');
check('a .7z counts as portable',
  kinds.fresh.find(a => a.name === 'bundle.7z')?.kind === 'portable');
check('a *-unpacked directory counts as unpacked',
  kinds.fresh.find(a => a.name === 'win-unpacked')?.kind === 'unpacked');
check('electron-builder scratch files are ignored',
  !names.includes('builder-effective-config.yaml') && !names.includes('latest.yml'),
  JSON.stringify(names));
check('a non-artefact directory is ignored', !names.includes('.icon-ico'),
  JSON.stringify(names));
check('an unpacked tree alone does not become an installable',
  classifyArtifacts([entry('win-unpacked', START + 1, { isDirectory: true })], START)
    .installer === null);

check('size is reported in MB', kinds.fresh[0].sizeMB === 50,
  String(kinds.fresh[0].sizeMB));
check('an empty directory is survivable',
  classifyArtifacts([], START).fresh.length === 0 && classifyArtifacts([], START).installer === null);
check('a null entry list is survivable', classifyArtifacts(null, START).fresh.length === 0);
check('an entry with no mtime is treated as stale, the safe direction',
  classifyArtifacts([entry('Setup.exe', undefined)], START).installer === null);

// ── launchInstaller refuses to be steered ───────────────────────────────────
console.log('\n--- launchInstaller must not be steerable outside the output directory ---');

(async () => {
  const traversal = await launchInstaller({ repoPath: 'C:/repo', fileName: '../../evil.exe' });
  check('a path traversal is refused', traversal.ok === false, JSON.stringify(traversal));
  check('and the reason names the constraint', /bare file name/.test(traversal.error || ''),
    traversal.error);

  const nested = await launchInstaller({ repoPath: 'C:/repo', fileName: 'sub/dir/Setup.exe' });
  check('a nested path is refused', nested.ok === false, JSON.stringify(nested));

  const notExe = await launchInstaller({ repoPath: 'C:/repo', fileName: 'notes.txt' });
  check('a non-executable is refused', notExe.ok === false, JSON.stringify(notExe));
  check('and says it is not an installer', /not an installer/.test(notExe.error || ''),
    notExe.error);

  const missingArgs = await launchInstaller({});
  check('missing arguments are refused', missingArgs.ok === false);

  const absent = await launchInstaller({
    repoPath: 'C:/definitely/not/here', fileName: 'Setup.exe',
  });
  check('a file that does not exist is refused rather than spawned',
    absent.ok === false && /not found/.test(absent.error || ''), JSON.stringify(absent));

  // ── build() guards ────────────────────────────────────────────────────────
  console.log('\n--- build() guards ---');
  const noRepo = await pipeline.build({});
  check('build with no repoPath refuses', noRepo.ok === false);
  const notSource = await pipeline.build({ repoPath: 'C:/definitely/not/here' });
  check('build against a non-source directory refuses', notSource.ok === false);
  check('and says what was missing', /package\.json/.test(notSource.error || ''),
    notSource.error);

  check('OUTPUT_DIR is the configured electron-builder output',
    pipeline.OUTPUT_DIR === 'dist-electron', pipeline.OUTPUT_DIR);
})();

// ── Version bumping (Section 87) ─────────────────────────────────────────────
//
// WHY THIS IS TESTED RATHER THAN TRUSTED. A release that does not bump publishes a version equal to
// what is already installed everywhere, so `updateChannel.status()` correctly reports every install
// as up to date — the build succeeds, the publish succeeds, and NOTHING is offered to anybody. A
// silent no-op that looks like a working release is exactly the failure a one-click button invites.
console.log('\n--- version bumping, which decides whether anyone is offered anything ---');
{
  const b = pipeline.bumpVersion;
  check('patch increments the last part', b('1.0.0', 'patch') === '1.0.1', b('1.0.0', 'patch'));
  check('minor increments and RESETS patch', b('1.2.7', 'minor') === '1.3.0', b('1.2.7', 'minor'));
  check('major increments and resets both', b('1.2.7', 'major') === '2.0.0', b('1.2.7', 'major'));
  check('patch is the default', b('1.0.0') === '1.0.1');
  check('none leaves it alone', b('1.2.3', 'none') === '1.2.3');
  check('9 rolls to 10, not to 0 — NOT a single-digit assumption',
    b('1.9.9', 'patch') === '1.9.10' && b('1.9.9', 'minor') === '1.10.0',
    `${b('1.9.9', 'patch')} / ${b('1.9.9', 'minor')}`);
  check('a leading v is dropped', b('v1.0.0', 'patch') === '1.0.1', b('v1.0.0', 'patch'));
  check('a short version is padded to three parts', b('1.2', 'patch') === '1.2.1',
    b('1.2', 'patch'));
  check('a single part is padded', b('2', 'minor') === '2.1.0', b('2', 'minor'));
  check('a pre-release suffix is dropped when bumping',
    b('1.0.0-beta.3', 'patch') === '1.0.1', b('1.0.0-beta.3', 'patch'));
  check('rubbish becomes 0.0.1 rather than throwing', b('nonsense', 'patch') === '0.0.1',
    b('nonsense', 'patch'));
  check('undefined does not throw', b(undefined, 'patch') === '0.0.1', b(undefined, 'patch'));
  check('a bumped version is always NEWER than what it came from', (() => {
    const chan = require('../electron/lib/updateChannel.cjs');
    for (const v of ['0.0.1', '1.0.0', '1.9.9', '2.13.4', '1.2']) {
      for (const kind of ['patch', 'minor', 'major']) {
        if (chan.compareVersions(b(v, kind), v) !== 1) return false;
      }
    }
    return true;
  })(), 'a bump produced a version that is not newer');
}

// ── release() guards ────────────────────────────────────────────────────────
console.log('\n--- release() refuses before it can do damage ---');
(async () => {
  const noRepo = await pipeline.release({});
  check('release with no repoPath refuses', noRepo.ok === false, JSON.stringify(noRepo));
  const notSrc = await pipeline.release({ repoPath: 'C:/definitely/not/here', pull: false });
  check('release against a non-source directory refuses', notSrc.ok === false);
  check('and names package.json', /package\.json/.test(notSrc.error || ''), notSrc.error);
  check('release is exported', typeof pipeline.release === 'function');
  check('bumpVersion is exported', typeof pipeline.bumpVersion === 'function');

  console.log(`\n${'='.repeat(62)}`);
  console.log(`  ${pass} passed, ${fail} failed  (including release composition)`);
  console.log('='.repeat(62));
  process.exit(fail ? 1 : 0);
})();
