'use strict';

/**
 * matsyaDestination.cjs — where snapshots go, decided rather than asked (Section 204).
 *
 * WHY THIS EXISTS. Section 193 left the destination to master and said the actor "takes a path and
 * has no opinion". That was correct for the actor and wrong as a product: master's answer to the
 * phrase command was that it made WORK for him, and "choose a backup destination" is more of the
 * same — a question he has to research before he can answer, asked by software that can see the
 * drives and he cannot.
 *
 * So Rāma chooses, and says what the choice does and does not protect against. He can override it;
 * he does not have to participate to be protected.
 *
 * THE RULE, in order:
 *   1. A DIFFERENT PHYSICAL DRIVE with room. This is the only choice that survives the failure
 *      people actually have — the disk dies — and it is preferred even when it is smaller.
 *   2. The same drive, with the limitation STATED. A same-disk copy still protects against the
 *      commonest losses: a file deleted, a bad edit, a corrupted store, ransomware caught early. It
 *      does not survive the disk failing, and saying so is the difference between a backup and a
 *      feeling.
 *   3. Nothing, when there is no room anywhere. A destination that cannot hold a snapshot is worse
 *      than none, because it reports success until the day it matters.
 *
 * NETWORK AND REMOVABLE DRIVES ARE NOT PREFERRED, deliberately. A NAS is an excellent destination and
 * a disconnected USB stick is an excellent way to have no backups for six months without noticing.
 * Rāma cannot tell which it is looking at from a mount table, so it prefers a fixed local disk it can
 * rely on being there, and master can point it at the NAS if he wants one.
 *
 * PURE. No `fs`, no `os`, no drive enumeration of its own — the drive list is passed in, so this is
 * drivable with any machine shape a suite cares to invent, including the ones nobody has.
 */

const path = require('path');

/** A snapshot of this app's data, with headroom for the next few. Deliberately generous. */
const DEFAULT_NEED_BYTES = 2 * 1024 * 1024 * 1024;   // 2 GiB
const FOLDER = 'Rama-Backups';

/** `C:` from `C:\Users\…`, `/` from `/home/…`. Lower-cased so comparisons are not case games. */
function volumeOf(p) {
  if (typeof p !== 'string' || p === '') return null;
  const win = /^([A-Za-z]):/.exec(p);
  if (win) return `${win[1].toLowerCase()}:`;
  return '/';
}

function volumeOfDrive(drive) {
  if (!drive || typeof drive !== 'object') return null;
  // `fs` is what systeminformation reports: `C:` on Windows, a device or mount elsewhere.
  const raw = typeof drive.fs === 'string' ? drive.fs : (drive.mount || '');
  const win = /^([A-Za-z]):/.exec(raw);
  if (win) return `${win[1].toLowerCase()}:`;
  if (typeof drive.mount === 'string' && drive.mount.startsWith('/')) return drive.mount;
  return raw || null;
}

const isNetwork = (d) => /^(cifs|smb|nfs|afp|webdav|fuse\.sshfs)/i.test(String(d?.type || ''));
const isRemovable = (d) => d?.removable === true;

/**
 * @param {object} args
 * @param {Array}  args.drives     `[{ fs, type, size, used, avail, mount?, removable? }]`
 * @param {string} args.dataDir    where this installation keeps its data
 * @param {number} [args.needBytes]
 * @returns {{
 *   ok:boolean, path:string|null, volume:string|null, sameVolume:boolean,
 *   reason:string, protects:string[], doesNotProtect:string[]
 * }}
 */
function choose({ drives = [], dataDir = '', needBytes = DEFAULT_NEED_BYTES } = {}) {
  const home = volumeOf(dataDir);
  const usable = (Array.isArray(drives) ? drives : [])
    .filter((d) => d && Number.isFinite(Number(d.avail)) && Number(d.avail) >= needBytes)
    .filter((d) => volumeOfDrive(d) !== null);

  const others = usable
    .filter((d) => volumeOfDrive(d) !== home)
    .filter((d) => !isNetwork(d) && !isRemovable(d))
    // Most free space first: the one least likely to need attention soonest.
    .sort((a, b) => Number(b.avail) - Number(a.avail));

  if (others.length > 0) {
    const vol = volumeOfDrive(others[0]);
    return {
      ok: true,
      path: vol.endsWith(':') ? path.join(`${vol.toUpperCase()}\\`, FOLDER) : path.join(vol, FOLDER),
      volume: vol,
      sameVolume: false,
      reason: `${vol.toUpperCase()} is a different drive from the one Rāma runs on, so a snapshot `
        + 'there survives that disk failing.',
      protects: [
        'a file deleted or overwritten by mistake',
        'a corrupted store',
        'this machine\'s main disk failing',
      ],
      doesNotProtect: [
        'the building burning down — for that, a copy that leaves the house is needed',
      ],
    };
  }

  const sameDrive = usable.find((d) => volumeOfDrive(d) === home);
  if (sameDrive) {
    return {
      ok: true,
      path: path.join(dataDir, '..', FOLDER),
      volume: home,
      sameVolume: true,
      // THE LIMITATION IS THE HEADLINE, not a footnote. A same-disk backup described as "backed up"
      // is how someone finds out the hard way.
      reason: 'No second drive has room, so snapshots go on the same disk. This protects against '
        + 'mistakes and corruption but NOT against that disk failing.',
      protects: [
        'a file deleted or overwritten by mistake',
        'a corrupted store',
        'a bad self-upgrade',
      ],
      doesNotProtect: [
        'this machine\'s disk failing — the snapshot dies with the original',
        'the machine being lost or stolen',
      ],
    };
  }

  return {
    ok: false,
    path: null,
    volume: null,
    sameVolume: false,
    reason: usable.length === 0 && drives.length > 0
      ? `No drive has the ${Math.round(needBytes / (1024 * 1024 * 1024))} GB a snapshot needs.`
      : 'No drives could be read, so there is nowhere to put a snapshot.',
    protects: [],
    doesNotProtect: ['anything at all — there is no destination'],
  };
}

module.exports = { choose, volumeOf, volumeOfDrive, DEFAULT_NEED_BYTES, FOLDER };
