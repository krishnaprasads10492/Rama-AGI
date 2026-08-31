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

  console.log(`\n${'='.repeat(62)}`);
  console.log(`  ${pass} passed, ${fail} failed`);
  console.log('='.repeat(62));
  process.exit(fail ? 1 : 0);
})();
