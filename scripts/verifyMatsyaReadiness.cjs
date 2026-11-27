'use strict';

/**
 * verifyMatsyaReadiness.cjs — Rāma decides where backups go and notices when there are none
 * (spec Section 204).
 *
 * WHAT MASTER ASKED FOR. He said the phrase command made work for him and to fold Matsya into Rāma's
 * capabilities instead. Two things follow, and both are guarded here:
 *
 *   1. RĀMA CHOOSES THE DESTINATION. "Pick a backup location" is a question that requires research
 *      to answer, asked by software that can see the drives and he cannot. So it is decided, with the
 *      limitations of the choice STATED rather than buried — a same-disk copy described as "backed
 *      up" is how someone finds out the hard way.
 *   2. RĀMA NOTICES. The result goes into the startup diagnosis, which `health:startup` already
 *      returns and `HealthPanel` already renders, so it arrives where he looks instead of somewhere
 *      he has to remember.
 *
 * AND THE ROW THAT STOPS THIS LYING: every remedy that tells master to run something must name a
 * script `package.json` actually defines. The first draft of the phrase remedy said "Open System →
 * Backup and press Generate", which is where this is going and does not exist yet.
 *
 * Run: node scripts/verifyMatsyaReadiness.cjs   (or npm run verify:matsya-readiness)
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const dest = require(path.join(ROOT, 'electron/lib/matsyaDestination.cjs'));
const ready = require(path.join(ROOT, 'electron/lib/matsyaReadiness.cjs'));
const state = require(path.join(ROOT, 'electron/lib/matsyaState.cjs'));
const doctor = require(path.join(ROOT, 'electron/lib/startupDoctor.cjs'));

let pass = 0;
let fail = 0;
function check(label, ok, detail) {
  if (ok) { pass += 1; console.log(`  PASS  ${label}`); return; }
  fail += 1;
  console.log(`  FAIL  ${label}${detail ? ` - ${detail}` : ''}`);
}
function eq(label, actual, expected) {
  check(label, actual === expected, `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}
const section = (t) => console.log(`\n  ${t}`);

const GB = 1024 ** 3;
const DAY = 864e5;

console.log('\nRama Matsya — where backups go, and noticing when there are none');

// ═══ (1) The destination, decided rather than asked ═══════════════════════
section('a second drive is preferred, because it survives the failure people actually have');

const twoDrives = [
  { fs: 'C:', type: 'NTFS', size: 500 * GB, avail: 90 * GB },
  { fs: 'D:', type: 'NTFS', size: 1000 * GB, avail: 800 * GB },
];
const picked = dest.choose({ drives: twoDrives, dataDir: 'C:\\app\\data' });
check('it picks the other drive', picked.ok && /^D:/.test(picked.path), picked.path);
eq('and says so', picked.sameVolume, false);
check('the reason names the disk failing, which is why it was preferred',
  /disk failing/i.test(picked.reason), picked.reason);
check('it lists what that protects against', picked.protects.length >= 3);
// REDBY: claim a local second disk survives the house burning down. It does not, and the honest
// limitation is what tells master whether he still needs an off-site copy.
check('and is honest that it is still all in one building',
  picked.doesNotProtect.some((s) => /burn|house|building/i.test(s)), picked.doesNotProtect.join(' | '));

section('the most free space wins among the alternatives');
const threeDrives = [
  { fs: 'C:', type: 'NTFS', avail: 90 * GB },
  { fs: 'D:', type: 'NTFS', avail: 40 * GB },
  { fs: 'E:', type: 'NTFS', avail: 800 * GB },
];
check('E: over D:', /^E:/.test(dest.choose({ drives: threeDrives, dataDir: 'C:\\d' }).path));

section('a network or removable drive is not chosen for him');
// A NAS is an excellent destination. A disconnected USB stick is an excellent way to have no backups
// for six months without noticing, and a mount table cannot tell them apart.
check('a network mount is not preferred',
  dest.choose({
    drives: [{ fs: 'C:', avail: 90 * GB }, { fs: 'Z:', type: 'cifs', avail: 900 * GB }],
    dataDir: 'C:\\d',
  }).sameVolume === true);
check('nor is a removable one',
  dest.choose({
    drives: [{ fs: 'C:', avail: 90 * GB }, { fs: 'F:', type: 'NTFS', avail: 900 * GB, removable: true }],
    dataDir: 'C:\\d',
  }).sameVolume === true);

section('one drive is still better than none, and the limit is the headline');
const same = dest.choose({ drives: [{ fs: 'C:', avail: 90 * GB }], dataDir: 'C:\\app\\data' });
check('a destination is still chosen', same.ok && typeof same.path === 'string');
eq('flagged as the same volume', same.sameVolume, true);
check('the reason says NOT against that disk failing, in those terms',
  /NOT/.test(same.reason) && /disk failing/i.test(same.reason), same.reason);
check('and the limitation list says the snapshot dies with the original',
  same.doesNotProtect.some((s) => /dies with the original/i.test(s)));

section('no room anywhere is reported as no destination, not as a destination');
// REDBY: return a path when nothing will fit. A destination that cannot hold a snapshot reports
// success until the day it matters.
const full = dest.choose({ drives: [{ fs: 'C:', avail: 1 * GB }], dataDir: 'C:\\d' });
eq('not ok', full.ok, false);
eq('and no path at all', full.path, null);
check('the reason says how much was needed', /GB/.test(full.reason), full.reason);
const none = dest.choose({ drives: [], dataDir: 'C:\\d' });
eq('no drives at all is also not ok', none.ok, false);
check('and distinguishes "nothing readable" from "nothing big enough"',
  /No drives could be read/i.test(none.reason) && !/GB/.test(none.reason), none.reason);

section('volumes are compared without case games');
eq('a lower-case path finds its drive', dest.volumeOf('c:\\users\\x'), 'c:');
eq('an upper-case one matches it', dest.volumeOf('C:\\Users\\X'), 'c:');
eq('a posix path is the root', dest.volumeOf('/home/x'), '/');
eq('nonsense has no volume', dest.volumeOf(''), null);

// ═══ (2) Noticing, in the shape the diagnosis already uses ════════════════
section('what master is told, and when he is told nothing');

const good = dest.choose({ drives: twoDrives, dataDir: 'C:\\app\\data' });
const now = Date.parse('2026-06-01T00:00:00.000Z');

const noPhrase = ready.assess({ destination: good, now });
eq('with no phrase, exactly one thing is asked of him', noPhrase.degraded.length, 1);
eq('and it is the phrase', noPhrase.degraded[0].id, 'matsya-no-phrase');
check('the detail says why it cannot be done for him',
  /replacement machine/i.test(noPhrase.degraded[0].detail), noPhrase.degraded[0].detail);

/*
 * REDBY: report "no phrase" AND "never run" together. They are one problem, and three entries for one
 * problem reads as three problems — which is how a health panel trains someone to ignore it.
 */
check('"never backed up" is NOT also reported while the phrase is missing',
  !noPhrase.degraded.some((e) => e.id === 'matsya-never-run'));

const readyToGo = ready.assess({ destination: good, phraseRecorded: true, phraseFingerprint: 'AAAA', now });
eq('once the phrase exists, the missing snapshot is reported', readyToGo.degraded[0].id, 'matsya-never-run');
check('and it asks nothing of him', /nothing to do/i.test(readyToGo.degraded[0].remedy));

const fresh = ready.assess({
  destination: good, phraseRecorded: true, lastSnapshotAt: new Date(now - 2 * DAY).toISOString(), now,
});
eq('a recent backup is ready', fresh.ready, true);
eq('and says nothing at all', fresh.degraded.length, 0);

const stale = ready.assess({
  destination: good, phraseRecorded: true, lastSnapshotAt: new Date(now - 40 * DAY).toISOString(), now,
});
eq('a 40-day-old backup is not ready', stale.ready, false);
eq('and is reported as stale', stale.degraded[0].id, 'matsya-stale');
check('with its real age, not "old"', /40 days/.test(stale.degraded[0].detail), stale.degraded[0].detail);
check('and at that age it suggests the schedule is broken, not that Rāma will handle it',
  /schedule/i.test(stale.degraded[0].remedy), stale.degraded[0].remedy);

const slightlyStale = ready.assess({
  destination: good, phraseRecorded: true, lastSnapshotAt: new Date(now - 9 * DAY).toISOString(), now,
});
check('nine days old asks nothing of him', /nothing to do/i.test(slightlyStale.degraded[0].remedy));

const nowhere = ready.assess({ destination: full, phraseRecorded: true, now });
eq('no destination is its own problem', nowhere.degraded[0].id, 'matsya-no-destination');

// REDBY: let `ready` be true when a snapshot exists but the destination has gone. Each condition is
// necessary, and "nearly ready" protects nothing.
for (const [label, facts] of [
  ['no destination', { destination: full, phraseRecorded: true, lastSnapshotAt: new Date(now).toISOString() }],
  ['no phrase', { destination: good, lastSnapshotAt: new Date(now).toISOString() }],
  ['no snapshot', { destination: good, phraseRecorded: true }],
  ['stale snapshot', { destination: good, phraseRecorded: true, lastSnapshotAt: new Date(now - 30 * DAY).toISOString() }],
]) {
  eq(`not ready: ${label}`, ready.assess({ ...facts, now }).ready, false);
}

section('an unparsable timestamp reads as never, not as today');
// REDBY: `Date.parse` returning NaN and being compared anyway. Every comparison with NaN is false,
// so a corrupt marker would silently read as a fresh backup.
const corrupt = ready.assess({ destination: good, phraseRecorded: true, lastSnapshotAt: 'not-a-date', now });
eq('not ready', corrupt.ready, false);
eq('reported as never run', corrupt.degraded[0].id, 'matsya-never-run');
eq('and the age is unknown rather than a number', corrupt.ageDays, null);

// ═══ (3) THE ROW THAT STOPS A REMEDY PROMISING SOMETHING THAT DOES NOT EXIST
section('every remedy names an action that actually exists');

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const allEntries = [
  ...noPhrase.degraded, ...readyToGo.degraded, ...stale.degraded, ...nowhere.degraded,
];
const promised = [];
for (const e of allEntries) {
  for (const m of String(e.remedy || '').matchAll(/npm run ([\w:-]+)/g)) {
    promised.push([e.id, m[1]]);
  }
}
check('at least one remedy names a command, so this row is not vacuous', promised.length > 0);
const missing = promised.filter(([, script]) => !(script in (pkg.scripts || {})));
check('and every command it names is a script package.json defines',
  missing.length === 0, missing.map(([id, s]) => `${id} promises "${s}"`).join('; '));

// The same hazard in prose: a remedy must not send him to a page that does not exist.
const pages = fs.readdirSync(path.join(ROOT, 'src/pages'));
const pointed = allEntries
  .map((e) => [e.id, (String(e.remedy).match(/System → (\w+)/) || [])[1]])
  .filter(([, p]) => p);
const absent = pointed.filter(([, p]) => !pages.includes(p));
check('no remedy points at a page that does not exist',
  absent.length === 0, absent.map(([id, p]) => `${id} points at System → ${p}`).join('; '));

// ═══ (4) It reaches the diagnosis, which already reaches the panel ════════
section('the diagnosis carries it, and a missing backup never stops the app');

const withBackup = doctor.diagnose({ backup: noPhrase, appRoot: ROOT });
check('the degradation appears in the diagnosis',
  withBackup.degraded.some((d) => d.id === 'matsya-no-phrase'));
check('and the report rows appear in the check list',
  withBackup.report.some((r) => r.label === 'recovery phrase'));
// REDBY: classify a missing backup as fatal. That makes Rāma refuse to start in order to protect
// data it is not yet protecting.
check('NOTHING about a missing backup is fatal',
  !withBackup.fatal.some((f) => String(f.id).startsWith('matsya')),
  withBackup.fatal.map((f) => f.id).join(', '));

const withoutBackup = doctor.diagnose({ appRoot: ROOT });
check('and a diagnosis with no backup facts still works',
  Array.isArray(withoutBackup.degraded) && Array.isArray(withoutBackup.report));
check('mentioning nothing about backups at all',
  !withoutBackup.report.some((r) => r.label === 'recovery phrase'));

// ═══ (5) Gathering the facts, on invented machines ════════════════════════
section('the facts are gathered from injected machines, including ones nobody owns');

/*
 * `volumes.keys()`, not `[...volumes]`. Spreading a Map yields `[key, value]` PAIRS, so comparing an
 * entry to a path is never true — the first version of this fake reported a machine with no drives
 * at all and three rows failed for a reason that had nothing to do with their subject.
 */
const fakeFs = (files, volumes) => ({
  exists: (p) => files.has(p) || [...volumes.keys()].includes(p),
  statfs: (p) => {
    if (!volumes.has(p)) throw new Error('ENOENT');
    return { bsize: 4096, bavail: volumes.get(p) / 4096, blocks: (volumes.get(p) * 2) / 4096 };
  },
  readDir: (p) => [...files.keys()]
    .filter((f) => f.startsWith(`${p}${path.sep}`))
    .map((f) => f.slice(p.length + 1).split(path.sep)[0]),
  readText: (p) => files.get(p),
});

{
  const volumes = new Map([['C:\\', 90 * GB], ['D:\\', 900 * GB]]);
  const io = fakeFs(new Map(), volumes);
  const d = state.drives({ platform: 'win32', ...io });
  eq('two volumes found', d.length, 2);
  check('with real byte figures', d.every((x) => x.avail > 0));
  const picked2 = dest.choose({ drives: d, dataDir: 'C:\\app\\data' });
  check('and the chooser prefers D:', /^D:/.test(picked2.path), picked2.path);
}
{
  // REDBY: report an unmeasurable volume as having zero space. Zero makes it look FULL, which is a
  // guess; omitting it is the truth, which is that we do not know.
  const io = fakeFs(new Map(), new Map([['C:\\', 90 * GB]]));
  const broken = { ...io, exists: (p) => p === 'C:\\' || p === 'E:\\', statfs: (p) => {
    if (p === 'E:\\') throw new Error('EACCES');
    return io.statfs(p);
  } };
  const d = state.drives({ platform: 'win32', ...broken });
  eq('a volume whose statfs THROWS is omitted', d.length, 1);
}
{
  /*
   * AND A VOLUME THAT ANSWERS WITH GARBAGE, which is a different failure from one that throws.
   *
   * A mutation that reported unmeasurable volumes as `avail: 0` survived the row above, because that
   * row only ever exercised the throwing path — the `continue` in the catch block means a throwing
   * volume never reaches the arithmetic. A driver that returns `NaN` does, and only this case can see
   * it. Zero would make the volume look FULL, which is a guess; omitting it says what is true, which
   * is that we do not know.
   */
  const volumes = new Map([['C:\\', 90 * GB]]);
  const io = fakeFs(new Map(), volumes);
  const garbage = {
    ...io,
    exists: (p) => p === 'C:\\' || p === 'E:\\',
    statfs: (p) => (p === 'E:\\' ? { bsize: NaN, bavail: NaN, blocks: NaN } : io.statfs(p)),
  };
  const d = state.drives({ platform: 'win32', ...garbage });
  eq('a volume that reports unusable figures is omitted too', d.length, 1);
  check('and the one that remains is the real one', d[0].fs === 'C:', JSON.stringify(d));
}
{
  const marker = path.join('D:\\Rama-Backups', '2026-05-01', 'SNAPSHOT.json');
  const older = path.join('D:\\Rama-Backups', '2026-04-01', 'SNAPSHOT.json');
  const files = new Map([
    [marker, JSON.stringify({ at: '2026-05-01T10:00:00.000Z', count: 12 })],
    [older, JSON.stringify({ at: '2026-04-01T10:00:00.000Z', count: 9 })],
  ]);
  const io = fakeFs(files, new Map([['D:\\', 900 * GB]]));
  const io2 = { ...io, exists: (p) => files.has(p) || p === 'D:\\Rama-Backups' || p === 'D:\\' };
  eq('the NEWEST marker is the last backup',
    state.lastSnapshotAt({ dest: 'D:\\Rama-Backups', ...io2 }), '2026-05-01T10:00:00.000Z');
  eq('a destination that does not exist means never',
    state.lastSnapshotAt({ dest: 'Z:\\nope', ...io2 }), null);
}
{
  // The marker is PLAINTEXT by design (193), so reading it needs no key. A corrupt one must not
  // throw its way out of the startup diagnosis.
  const bad = path.join('D:\\B', 'x', 'SNAPSHOT.json');
  const files = new Map([[bad, '{ not json']]);
  const io = fakeFs(files, new Map());
  const io2 = { ...io, exists: (p) => files.has(p) || p === 'D:\\B' };
  eq('an unreadable marker reads as never', state.lastSnapshotAt({ dest: 'D:\\B', ...io2 }), null);
}

section('gathering is total: nothing here can stop the health report appearing');
// REDBY: let one throw escape. This runs inside the startup diagnosis, so a backup check that breaks
// the diagnosis is a worse bug than the one it looks for.
const exploded = state.gather({
  dataDir: 'C:\\d',
  phraseRecordPath: 'C:\\d\\p.json',
  platform: 'win32',
  exists: () => { throw new Error('disk on fire'); },
  statfs: () => { throw new Error('disk on fire'); },
  readDir: () => { throw new Error('disk on fire'); },
  readText: () => { throw new Error('disk on fire'); },
});
check('a filesystem that throws on everything still returns facts',
  exploded && typeof exploded === 'object' && exploded.destination);
eq('with no destination', exploded.destination.ok, false);
eq('no phrase', exploded.phraseRecorded, false);
eq('and no snapshot', exploded.lastSnapshotAt, null);
check('and the readiness judgement still produces something to say',
  ready.assess({ ...exploded, now }).degraded.length > 0);

section('the judgements cannot act');
for (const [name, file] of [
  ['matsyaDestination', 'electron/lib/matsyaDestination.cjs'],
  ['matsyaReadiness', 'electron/lib/matsyaReadiness.cjs'],
]) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  check(`${name} touches no filesystem`, !/readFile|writeFile|existsSync|statfs|readdir/.test(src));
  /*
   * `exec` ALONE IS TOO BROAD: `RegExp.prototype.exec` is how both modules parse a drive letter, so
   * a bare /exec/ flagged a pure module as spawning processes. The patterns below name the actual
   * process APIs, which is what the row is about.
   */
  check(`${name} spawns nothing`,
    !/child_process|spawnSync|\bspawn\s*\(|execSync|execFile|\bexec\s*\(\s*['"`]/.test(src));
  check(`${name} reaches no network`, !/require\('(http|https|net)'\)|fetch\(/.test(src));
}

console.log('\n  held by hand, listed rather than implied:');
console.log('    - Rāma chooses a destination; it does not verify the drive is healthy, or that a');
console.log('      network path will still be mounted tomorrow. A chosen destination is not a');
console.log('      guaranteed one');
console.log('    - nothing here takes a backup. This tranche is the noticing and the choosing;');
console.log('      the schedule that acts on it is still to come');
console.log('    - the panel the remedy will eventually point at does not exist yet, which is why');
console.log('      the remedy names a command instead, and why the row above checks that it does');

console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'} — ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
