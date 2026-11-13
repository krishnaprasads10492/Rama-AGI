'use strict';

/**
 * matsyaSnapshot.cjs — the actor: take a snapshot, and prove it restores (spec Section 193)
 *
 * `matsya.cjs` decides WHAT may leave and in what form. This performs the act, and it is kept
 * separate for the reason Section 184.4 requires: the judgement's reason to change is the egress
 * policy, and this one's is the storage format. Mixing them would make the policy untestable
 * without a disk, which is how an egress rule goes quietly wrong.
 *
 * EVERYTHING IS INJECTED — `read`, `write`, `encrypt`, `decrypt`, `digest`, `now`. Not for purity's
 * sake: it is what lets the round trip be PROVEN. The suite snapshots a fake tree, restores it into
 * another, and compares digests, which is the only check that actually answers "would this bring
 * master's data back". It also keeps the key out of this module entirely, which matters because
 * WHICH KEY encrypts a backup is still master's open decision (192.5) and a default here would
 * quietly make it for him.
 *
 * THREE DESIGN DECISIONS THAT ARE NOT OBVIOUS
 *
 * 1. BLOBS ARE NAMED BY DIGEST, NEVER BY PATH. Writing `data/knowledge/private-notes.md.enc` into
 *    the destination would put the entire directory tree in CLEARTEXT FILENAMES — an inventory of
 *    master's material, readable by anyone who can list the folder, defeating the point of
 *    encrypting the contents. Blobs are `<digest>.blob`; the path mapping lives only inside the
 *    encrypted manifest.
 *
 * 2. THE MANIFEST IS ENCRYPTED TOO. It is a list of every path, size and digest — the same
 *    inventory. `matsya.cjs` classifies readiness reports and logs as `encrypt` for exactly this
 *    reason, so the index cannot be held to a weaker standard than the files it indexes.
 *
 * 3. A PLAINTEXT MARKER, AND ONLY THIS. `SNAPSHOT.json` carries the format version, the time, and
 *    the file count. Something must be readable or a destination full of hex blobs is unidentifiable
 *    a year later, and "a Rāma snapshot of N files" is not an inventory. Deliberately no paths,
 *    no hostname, no version of the app.
 *
 * NOTHING IS DELETED, EVER. There is no prune, no rotate, no overwrite of a previous snapshot.
 * A backup tool that can remove data is a backup tool that can be turned into a weapon by a bug,
 * and Section 169 named Varaha and Kalki as the restore paths — neither needs this to delete.
 */

const path = require('path');

const matsya = require('./matsya.cjs');

const FORMAT = 1;
const MARKER = 'SNAPSHOT.json';
const MANIFEST = 'MANIFEST.enc';
const BLOBS = 'blobs';

/** Join for the destination, kept POSIX so a manifest written on Windows restores on Linux. */
const dest = (...parts) => parts.join('/');

/**
 * Take a snapshot.
 *
 * @param {object} io
 * @param {string[]} io.files                 repository-relative paths to consider
 * @param {(p:string)=>Buffer} io.read
 * @param {(p:string,b:Buffer)=>void} io.write   writes into the DESTINATION
 * @param {(b:Buffer)=>Buffer} io.encrypt
 * @param {(b:Buffer)=>string} io.digest
 * @param {string} io.out                     destination root
 * @param {()=>string} [io.now]
 * @returns {{ok:boolean, written:number, refused:Array, manifest:object, marker:object, error:string|null}}
 */
function snapshot({ files = [], read, write, encrypt, digest, out = '.', now = () => new Date().toISOString() } = {}) {
  for (const [name, fn] of [['read', read], ['write', write], ['encrypt', encrypt], ['digest', digest]]) {
    // NO DEFAULTS. A missing cipher must not fall back to "write it in the clear", which is the
    // one failure mode this module exists to make impossible.
    if (typeof fn !== 'function') {
      return { ok: false, written: 0, refused: [], manifest: null, marker: null,
        error: `${name} was not supplied, and a snapshot will not be written without it` };
    }
  }

  const plan = matsya.plan(files);
  const entries = [];
  const failures = [];

  for (const item of [...plan.copy, ...plan.encrypt]) {
    let bytes;
    try { bytes = read(item.path); }
    catch (err) {
      // CARRIED, NOT SWALLOWED. A file that could not be read is not a file that was backed up,
      // and a snapshot reporting success over an unreadable file is the comfortable lie.
      failures.push({ path: item.path, error: err.message });
      continue;
    }
    if (!Buffer.isBuffer(bytes)) {
      failures.push({ path: item.path, error: 'read did not return a Buffer' });
      continue;
    }
    // `ciphertext` is already encrypted at rest, so it is stored as-is; `encrypt` is wrapped here.
    const stored = item.cls === 'encrypt' ? encrypt(bytes) : bytes;
    const d = digest(stored);
    try { write(dest(out, BLOBS, `${d}.blob`), stored); }
    catch (err) { failures.push({ path: item.path, error: err.message }); continue; }
    entries.push({ path: item.path, cls: item.cls, bytes: bytes.length, digest: d });
  }

  const manifest = matsya.manifest(entries, { at: now(), version: FORMAT });
  let wroteIndex = true;
  try {
    write(dest(out, MANIFEST), encrypt(Buffer.from(JSON.stringify(manifest), 'utf8')));
  } catch (err) {
    wroteIndex = false;
    failures.push({ path: MANIFEST, error: err.message });
  }

  const marker = { format: FORMAT, at: manifest.at, count: manifest.count, encrypted: true };
  try { write(dest(out, MARKER), Buffer.from(JSON.stringify(marker, null, 2), 'utf8')); }
  catch (err) { failures.push({ path: MARKER, error: err.message }); }

  return {
    // A SNAPSHOT WITHOUT ITS INDEX IS NOT A SNAPSHOT — it is a pile of unidentifiable blobs, so a
    // failed manifest write fails the whole operation rather than degrading.
    ok: wroteIndex && failures.length === 0,
    written: entries.length,
    refused: plan.refuse,
    failures,
    manifest,
    marker,
    error: failures.length ? `${failures.length} file(s) could not be stored` : null,
  };
}

/**
 * Restore a snapshot, and say what does not match.
 *
 * Restores into a destination the caller chooses — never over the live tree by default, because a
 * restore that overwrites the only good copy with a bad one is the disaster it exists to prevent.
 * The caller names the target; this never assumes the data directory.
 */
function restore({ manifest, read, write, decrypt, digest, from = '.', into = '.' } = {}) {
  for (const [name, fn] of [['read', read], ['write', write], ['decrypt', decrypt], ['digest', digest]]) {
    if (typeof fn !== 'function') {
      return { ok: false, restored: 0, missing: [], altered: [], error: `${name} was not supplied` };
    }
  }
  const rows = manifest && Array.isArray(manifest.entries) ? manifest.entries : null;
  if (!rows) {
    return { ok: false, restored: 0, missing: [], altered: [],
      error: 'no manifest was supplied, so there is nothing to restore against' };
  }

  const missing = [];
  const altered = [];
  let restored = 0;
  for (const row of rows) {
    const blob = dest(from, BLOBS, `${row.digest}.blob`);
    let stored;
    try { stored = read(blob); }
    catch { missing.push(row.path); continue; }
    // VERIFIED BEFORE IT IS WRITTEN, not after. A blob whose digest does not match was altered in
    // the destination, and writing it into the restore target first would mean the corruption
    // arrives on disk before anyone is told.
    if (digest(stored) !== row.digest) {
      altered.push({ path: row.path, expected: row.digest, found: digest(stored) });
      continue;
    }
    const bytes = row.cls === 'encrypt' ? decrypt(stored) : stored;
    try { write(dest(into, row.path), bytes); restored += 1; }
    catch (err) { altered.push({ path: row.path, expected: row.digest, found: `write failed: ${err.message}` }); }
  }
  return {
    ok: missing.length === 0 && altered.length === 0,
    restored,
    missing,
    altered,
    error: missing.length || altered.length
      ? `${missing.length} missing, ${altered.length} altered` : null,
  };
}

/** Read the index back out of a destination. Needs the key, which is the point. */
function readManifest({ read, decrypt, from = '.' } = {}) {
  if (typeof read !== 'function' || typeof decrypt !== 'function') {
    return { ok: false, manifest: null, error: 'read and decrypt are both required' };
  }
  try {
    const raw = decrypt(read(dest(from, MANIFEST)));
    return { ok: true, manifest: JSON.parse(raw.toString('utf8')), error: null };
  } catch (err) {
    return { ok: false, manifest: null, error: `the manifest could not be read: ${err.message}` };
  }
}

module.exports = { snapshot, restore, readManifest, FORMAT, MARKER, MANIFEST, BLOBS };
