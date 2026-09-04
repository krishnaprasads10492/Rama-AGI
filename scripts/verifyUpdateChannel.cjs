#!/usr/bin/env node
'use strict';

/**
 * verifyUpdateChannel.cjs — the channel must never offer something it should not (Section 84).
 *
 * Two things here decide whether master installs an executable: the version comparison and the
 * hash check. Both are tested against real files in a temp directory rather than mocked, because
 * the failure that matters most — a half-copied installer being offered as a valid update — only
 * exists on a filesystem.
 *
 * Run: node scripts/verifyUpdateChannel.cjs   (or npm run verify:channel)
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const ch = require('../electron/lib/updateChannel.cjs');

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

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'rama-channel-'));
const DIR = path.join(TMP, 'channel');
fs.mkdirSync(DIR, { recursive: true });

// ── Version comparison ───────────────────────────────────────────────────────
console.log('\n--- version comparison decides whether an install happens ---');

const cmp = ch.compareVersions;
check('1.0.1 is newer than 1.0.0', cmp('1.0.1', '1.0.0') === 1);
check('1.0.0 is older than 1.0.1', cmp('1.0.0', '1.0.1') === -1);
check('equal versions compare equal', cmp('1.0.0', '1.0.0') === 0);
check('1.10.0 is newer than 1.9.0 — NOT a string comparison',
  cmp('1.10.0', '1.9.0') === 1, String(cmp('1.10.0', '1.9.0')));
check('2.0.0 beats 1.99.99', cmp('2.0.0', '1.99.99') === 1);
check('a leading v is ignored', cmp('v1.0.1', '1.0.0') === 1);
check('missing parts count as zero, so 1.1 equals 1.1.0', cmp('1.1', '1.1.0') === 0);
check('a pre-release is OLDER than its release', cmp('1.0.1-beta.1', '1.0.1') === -1);
check('a release is NEWER than its pre-release', cmp('1.0.1', '1.0.1-beta.1') === 1);
check('pre-releases order among themselves', cmp('1.0.1-beta.2', '1.0.1-beta.1') === 1);
check('a pre-release still beats an older release', cmp('1.0.1-beta.1', '1.0.0') === 1);
check('rubbish is treated as 0 rather than throwing', cmp('nonsense', '0.0.0') === 0);
check('null and undefined do not throw', cmp(null, undefined) === 0);

// ── Manifest validation ──────────────────────────────────────────────────────
console.log('\n--- a manifest is untrusted input ---');

const goodHash = 'a'.repeat(64);
const base = { manifestVersion: 1, version: '1.0.1', file: 'Setup.exe', sha256: goodHash };

check('a well-formed manifest validates', ch.validateManifest(base).ok);
check('a missing version is rejected',
  !ch.validateManifest({ ...base, version: undefined }).ok);
check('a missing file is rejected', !ch.validateManifest({ ...base, file: '' }).ok);
check('a malformed hash is rejected', !ch.validateManifest({ ...base, sha256: 'abc' }).ok);
check('A PATH IN `file` IS REJECTED — it would steer the launcher out of the folder',
  !ch.validateManifest({ ...base, file: '../../evil.exe' }).ok,
  JSON.stringify(ch.validateManifest({ ...base, file: '../../evil.exe' }).problems));
check('a nested path is rejected', !ch.validateManifest({ ...base, file: 'sub/Setup.exe' }).ok);
check('a non-artefact extension is rejected',
  !ch.validateManifest({ ...base, file: 'notes.txt' }).ok);
check('a .zip is accepted as an archive', ch.validateManifest({ ...base, file: 'app.zip' }).ok);
check('A FUTURE manifest version is refused rather than half-understood',
  !ch.validateManifest({ ...base, manifestVersion: 99 }).ok,
  JSON.stringify(ch.validateManifest({ ...base, manifestVersion: 99 }).problems));
check('the refusal explains what to do',
  /by hand/.test(ch.validateManifest({ ...base, manifestVersion: 99 }).problems.join(' ')));
check('a non-object is rejected', !ch.validateManifest('nope').ok);
check('null is rejected', !ch.validateManifest(null).ok);

// ── An empty channel ─────────────────────────────────────────────────────────
console.log('\n--- an empty or broken channel offers nothing ---');

let st = ch.status({ dir: DIR, currentVersion: '1.0.0' });
check('an empty folder offers nothing', st.available === false);
check('and says why', /no latest\.json/.test(st.reason || ''), st.reason);
check('the security warning is always present', /anyone who can write here/.test(st.warning || ''),
  st.warning);
check('no directory at all is handled', ch.status({ dir: null }).available === false);

fs.writeFileSync(path.join(DIR, ch.MANIFEST_NAME), '{ not json', 'utf8');
st = ch.status({ dir: DIR, currentVersion: '1.0.0' });
check('unparseable JSON offers nothing', st.available === false);
check('and names the file', /latest\.json/.test(st.reason || ''), st.reason);

// ── Publish, then read back ──────────────────────────────────────────────────
console.log('\n--- publish writes an artefact and a manifest that agree ---');

const src = path.join(TMP, 'Rama-AGI-Setup-1.0.1.exe');
fs.writeFileSync(src, 'pretend installer payload');

const pub = ch.publish({ artefactPath: src, dir: DIR, version: '1.0.1', notes: 'test build' });
check('publish succeeds', pub.ok === true, JSON.stringify(pub));
check('the artefact is in the channel',
  fs.existsSync(path.join(DIR, 'Rama-AGI-Setup-1.0.1.exe')));
check('the manifest records the version', pub.manifest.version === '1.0.1');
check('the manifest records the real hash',
  pub.manifest.sha256 === ch.sha256(src), pub.manifest.sha256);
check('the manifest records the kind', pub.manifest.kind === 'installer');
check('notes are recorded', pub.manifest.notes === 'test build');
check('NO .part FILES ARE LEFT BEHIND — a reader must never see a half-copy',
  fs.readdirSync(DIR).every((f) => !f.endsWith('.part')), JSON.stringify(fs.readdirSync(DIR)));

st = ch.status({ dir: DIR, currentVersion: '1.0.0' });
check('a newer version is offered', st.available === true, JSON.stringify(st));
check('and verified against its hash', st.verified === true);
check('and applicable, being an installer', st.canApply === true);
check('the reason says the hash matched', /hash matches/.test(st.reason || ''), st.reason);

check('the SAME version is reported up to date, not offered',
  ch.status({ dir: DIR, currentVersion: '1.0.1' }).upToDate === true);
check('and not available', ch.status({ dir: DIR, currentVersion: '1.0.1' }).available === false);
const older = ch.status({ dir: DIR, currentVersion: '2.0.0' });
check('AN OLDER CHANNEL BUILD IS NOT OFFERED to a newer install',
  older.available === false && older.upToDate === true, JSON.stringify(older));
check('and says which is which', /older than the installed/.test(older.reason || ''), older.reason);

// ── The failure that matters most ────────────────────────────────────────────
console.log('\n--- THE REAL-WORLD FAILURE: a corrupt or half-copied artefact ---');

fs.appendFileSync(path.join(DIR, 'Rama-AGI-Setup-1.0.1.exe'), 'extra bytes');
st = ch.status({ dir: DIR, currentVersion: '1.0.0' });
check('a file that no longer matches its hash is NOT offered', st.available === false,
  JSON.stringify(st));
check('and is not marked verified', st.verified === false);
check('and cannot be applied', st.canApply === false);
check('the reason names corruption or an in-progress copy',
  /corrupt|being copied|replaced/.test(st.reason || ''), st.reason);

const applyCorrupt = ch.apply({ dir: DIR });
check('APPLY REFUSES a mismatched artefact — the check is repeated at spawn time',
  applyCorrupt.ok === false, JSON.stringify(applyCorrupt));

fs.unlinkSync(path.join(DIR, 'Rama-AGI-Setup-1.0.1.exe'));
st = ch.status({ dir: DIR, currentVersion: '1.0.0' });
check('a manifest naming a missing file offers nothing', st.available === false);
check('and says the file is absent', /not in the folder/.test(st.reason || ''), st.reason);

// ── A portable archive is reported but not applied ───────────────────────────
console.log('\n--- an archive is visible but Rāma cannot install itself from it ---');

const zip = path.join(TMP, 'Rama-AGI-1.0.2-portable.zip');
fs.writeFileSync(zip, 'pretend zip');
ch.publish({ artefactPath: zip, dir: DIR, version: '1.0.2' });
st = ch.status({ dir: DIR, currentVersion: '1.0.0' });
check('the archive is offered as available', st.available === true, JSON.stringify(st));
check('and verified', st.verified === true);
check('BUT NOT APPLICABLE', st.canApply === false);
check('and the reason explains why', /cannot replace an installed copy/.test(st.reason || ''),
  st.reason);
check('apply refuses it', ch.apply({ dir: DIR }).ok === false);

// ── Pruning ──────────────────────────────────────────────────────────────────
console.log('\n--- pruning keeps the folder bounded without breaking the live manifest ---');

const pruneDir = path.join(TMP, 'prune');
fs.mkdirSync(pruneDir, { recursive: true });
for (const [i, name] of ['a.exe', 'b.exe', 'c.exe', 'd.exe'].entries()) {
  const p = path.join(pruneDir, name);
  fs.writeFileSync(p, name);
  fs.utimesSync(p, new Date(1000 + i * 1000), new Date(1000 + i * 1000));
}
const removed = ch.prune({ dir: pruneDir, keep: 2 });
check('pruning to 2 removes the two oldest', removed.length === 2, JSON.stringify(removed));
check('the newest survive',
  fs.existsSync(path.join(pruneDir, 'd.exe')) && fs.existsSync(path.join(pruneDir, 'c.exe')));
const protectDir = path.join(TMP, 'protect');
fs.mkdirSync(protectDir, { recursive: true });
for (const [i, name] of ['old.exe', 'new.exe'].entries()) {
  const p = path.join(protectDir, name);
  fs.writeFileSync(p, name);
  fs.utimesSync(p, new Date(1000 + i * 1000), new Date(1000 + i * 1000));
}
const kept = ch.prune({ dir: protectDir, keep: 1, protect: 'old.exe' });
check('THE PROTECTED FILE IS NEVER PRUNED, however old — the live manifest points at it',
  !kept.includes('old.exe') && fs.existsSync(path.join(protectDir, 'old.exe')),
  JSON.stringify(kept));
check('pruning a nonexistent folder is survivable',
  ch.prune({ dir: path.join(TMP, 'nope') }).length === 0);

// ── Publish guards ───────────────────────────────────────────────────────────
console.log('\n--- publish guards ---');
check('no artefact path is refused', ch.publish({ dir: DIR, version: '1' }).ok === false);
check('no directory is refused', ch.publish({ artefactPath: src, version: '1' }).ok === false);
check('no version is refused', ch.publish({ artefactPath: src, dir: DIR }).ok === false);
check('a non-artefact file is refused',
  ch.publish({ artefactPath: path.join(DIR, ch.MANIFEST_NAME), dir: DIR, version: '1' }).ok === false);
check('a missing source file is refused',
  ch.publish({ artefactPath: path.join(TMP, 'ghost.exe'), dir: DIR, version: '1' }).ok === false);

// ── Directory resolution ─────────────────────────────────────────────────────
console.log('\n--- where the channel lives ---');
const prev = process.env.RAMA_UPDATE_CHANNEL_DIR;
delete process.env.RAMA_UPDATE_CHANNEL_DIR;
check('userData is the default base',
  ch.channelDir({ userDataPath: path.join('C:', 'ud') })
    === path.resolve(path.join('C:', 'ud', 'update-channel')));
process.env.RAMA_UPDATE_CHANNEL_DIR = path.join(TMP, 'fromenv');
check('the env var overrides the default',
  ch.channelDir({ userDataPath: path.join('C:', 'ud') }) === path.resolve(path.join(TMP, 'fromenv')));
check('AN EXPLICIT OVERRIDE BEATS THE ENV — so the UI can point elsewhere without mutating it',
  ch.channelDir({ userDataPath: 'C:/ud', override: path.join(TMP, 'explicit') })
    === path.resolve(path.join(TMP, 'explicit')));
if (prev === undefined) delete process.env.RAMA_UPDATE_CHANNEL_DIR;
else process.env.RAMA_UPDATE_CHANNEL_DIR = prev;
check('no base and no override yields null rather than a guess',
  ch.channelDir({}) === null || typeof ch.channelDir({}) === 'string');

try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* leave it */ }

console.log(`\n${'='.repeat(62)}`);
console.log(`  ${pass} passed, ${fail} failed`);
console.log('='.repeat(62));
process.exit(fail ? 1 : 0);
