'use strict';

/**
 * matsyaState.cjs — the facts the backup judgements need, gathered cheaply (Section 204).
 *
 * `matsyaDestination` and `matsyaReadiness` are pure and take facts. Something has to find those
 * facts, and this is the only file in the set that touches a disk.
 *
 * WHY NOT `systeminformation`, WHICH IS ALREADY A DEPENDENCY. `si.fsSize()` is what `system.cjs` uses
 * for the disk panel, and it is the obvious answer. It is also asynchronous and comparatively slow,
 * and this runs inside the startup diagnosis — a stage whose whole purpose is to finish quickly and
 * tell master what is wrong. `fs.statfsSync` is in Node itself, needs no dependency, and answers the
 * only question being asked: how much room is on each volume.
 *
 * WHY PROBING DRIVE LETTERS IS ACCEPTABLE HERE. Walking `C:` to `Z:` with `existsSync` looks crude
 * and is the cheapest reliable enumeration on Windows without a native call. The cost is bounded at
 * twenty-four stats of a directory root, which the OS answers from cache. On anything else there is
 * one root, `/`, and the loop does not run.
 *
 * EVERY DEPENDENCY IS INJECTED — `exists`, `statfs`, `readText`, `readDir`, `platform`. A suite can
 * therefore describe a machine with two drives, one full drive, an unreadable volume or no drives at
 * all, none of which can be arranged on the machine running the test.
 */

const path = require('path');

const MARKER = 'SNAPSHOT.json';

/** Candidate volume roots. One on POSIX, up to twenty-four on Windows. */
function volumeRoots(platform, exists) {
  if (platform !== 'win32') return ['/'];
  const roots = [];
  for (let c = 'C'.charCodeAt(0); c <= 'Z'.charCodeAt(0); c += 1) {
    const root = `${String.fromCharCode(c)}:\\`;
    if (exists(root)) roots.push(root);
  }
  return roots;
}

/**
 * Drives in the shape `matsyaDestination.choose` wants.
 *
 * A volume that cannot be measured is OMITTED rather than reported with zero space: zero would make
 * it look full, which is a guess, and absent is the truth — we do not know.
 */
function drives({ platform = process.platform, exists, statfs } = {}) {
  const out = [];
  for (const root of volumeRoots(platform, exists)) {
    let st;
    try {
      st = statfs(root);
    } catch {
      continue;
    }
    const block = Number(st?.bsize);
    const free = Number(st?.bavail ?? st?.bfree);
    const total = Number(st?.blocks);
    if (!Number.isFinite(block) || !Number.isFinite(free)) continue;
    out.push({
      fs: platform === 'win32' ? root.slice(0, 2) : root,
      mount: root,
      type: 'local',
      size: Number.isFinite(total) ? total * block : null,
      avail: free * block,
    });
  }
  return out;
}

/**
 * When was the last snapshot taken, according to the destination itself?
 *
 * Read from the plaintext marker Section 193 writes — format, time and count, and nothing else — so
 * this needs no key and no phrase. Snapshots live in dated folders, so the newest marker wins.
 *
 * Returns null for "cannot tell", which `matsyaReadiness` treats as "never", because a backup that
 * cannot be found is not a backup you have.
 */
function lastSnapshotAt({ dest, exists, readDir, readText }) {
  if (!dest || !exists(dest)) return null;
  let entries;
  try {
    entries = readDir(dest);
  } catch {
    return null;
  }
  let newest = null;
  for (const name of entries) {
    const markerPath = path.join(dest, name, MARKER);
    let raw;
    try {
      if (!exists(markerPath)) continue;
      raw = readText(markerPath);
    } catch {
      continue;
    }
    let when;
    try {
      when = JSON.parse(raw)?.at;
    } catch {
      continue;
    }
    const t = Date.parse(when);
    if (!Number.isFinite(t)) continue;
    if (newest === null || t > Date.parse(newest)) newest = when;
  }
  return newest;
}

/**
 * Everything the diagnosis needs, in one call.
 *
 * Deliberately total: any failure in here degrades to "cannot tell" rather than throwing, because
 * this runs inside the startup diagnosis and a backup check that prevents the app from reporting its
 * own health would be a worse bug than the one it is looking for.
 */
function gather({
  dataDir,
  phraseRecordPath,
  destinationOverride = null,
  platform = process.platform,
  exists,
  statfs,
  readDir,
  readText,
} = {}) {
  const destMod = require('./matsyaDestination.cjs');
  const recMod = require('./matsyaPhraseRecord.cjs');

  let destination;
  try {
    destination = destinationOverride
      ? { ok: true, path: destinationOverride, volume: null, sameVolume: false,
        reason: 'Set by master.', protects: [], doesNotProtect: [] }
      : destMod.choose({ drives: drives({ platform, exists, statfs }), dataDir });
  } catch (err) {
    destination = { ok: false, path: null, volume: null, sameVolume: false,
      reason: `The drives could not be read (${err.message}).`, protects: [], doesNotProtect: [] };
  }

  let record = { present: false, fingerprint: null, error: null };
  try {
    record = recMod.readRecord({
      readText: () => (exists(phraseRecordPath) ? readText(phraseRecordPath) : null),
    });
  } catch { /* leave it absent: the readiness entry then asks for a phrase, which is the safe ask */ }

  let last = null;
  try {
    last = lastSnapshotAt({ dest: destination.path, exists, readDir, readText });
  } catch { /* null means never, which is the honest reading of "cannot tell" */ }

  return {
    destination,
    phraseRecorded: record.present === true && !record.error && !!record.fingerprint,
    phraseFingerprint: record.fingerprint,
    lastSnapshotAt: last,
  };
}

module.exports = { gather, drives, lastSnapshotAt, volumeRoots, MARKER };
