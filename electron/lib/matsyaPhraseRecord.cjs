'use strict';

/**
 * matsyaPhraseRecord.cjs — what is remembered about a recovery phrase, which is only its name
 * (Section 203).
 *
 * `matsyaKey.cjs` deliberately requires nothing but `crypto` and keeps no state, and its suite
 * asserts both. Someone has to remember WHICH phrase the snapshots belong to, though, or master is
 * left holding a piece of paper with no way to tell whether it matches the folder in front of him.
 * That is this module, kept separate so the crypto stays provably inert.
 *
 * WHAT IS WRITTEN: the fingerprint, the date, and the format version. Nothing else, ever.
 * The fingerprint is an independent HKDF output (202.2), so it names a phrase without being any part
 * of the key — publishing it beside a snapshot gives an attacker nothing they did not already have
 * by holding the snapshot.
 *
 * WHAT IS NEVER WRITTEN: the phrase, the secret, the derived key. If this file ever gains a field for
 * any of them, the entire point of master's choice in 192.5 — the key lives on paper and nowhere a
 * machine failure can take it — is gone, and the backup becomes exactly as mortal as the machine.
 * `verifyMatsyaPhrase` asserts the written shape, not just the intent.
 *
 * THE DANGEROUS CASE THIS EXISTS FOR. Generating a second phrase is not an error and not an
 * improvement: it silently ORPHANS every snapshot taken with the first. Nothing breaks, nothing
 * warns, and the loss is discovered at the only moment it matters. So `judgeNew` refuses when a
 * record already exists unless the caller passes an explicit confirmation, and the refusal says what
 * would be lost rather than "already exists".
 *
 * Everything is injected, so the judgement can be driven with no filesystem.
 */

const FORMAT = 'rama.matsya.phrase.v1';

/**
 * @param {object} io
 * @param {() => string|null} io.readText  the record file's contents, or null when absent
 * @returns {{present:boolean, fingerprint:string|null, createdAt:string|null, error:string|null}}
 */
function readRecord({ readText }) {
  if (typeof readText !== 'function') throw new Error('matsyaPhraseRecord: readText is required');
  let raw;
  try {
    raw = readText();
  } catch (err) {
    // A record that cannot be read must NOT look like a record that is absent: the first would make
    // `judgeNew` offer to generate a phrase that orphans existing snapshots.
    return { present: true, fingerprint: null, createdAt: null, error: `unreadable: ${err.message}` };
  }
  if (raw === null || raw === undefined || String(raw).trim() === '') {
    return { present: false, fingerprint: null, createdAt: null, error: null };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { present: true, fingerprint: null, createdAt: null, error: 'the record is not valid JSON' };
  }
  if (!parsed || typeof parsed.fingerprint !== 'string' || parsed.fingerprint === '') {
    return { present: true, fingerprint: null, createdAt: null, error: 'the record has no fingerprint' };
  }
  return {
    present: true,
    fingerprint: parsed.fingerprint,
    createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : null,
    error: null,
  };
}

/**
 * May a new phrase be generated?
 *
 * @param {object} record     from `readRecord`
 * @param {boolean} confirmed did the caller explicitly say they accept losing the old snapshots
 * @returns {{allow:boolean, reason:string|null}}
 */
function judgeNew(record, { confirmed = false } = {}) {
  if (!record || record.present !== true) return { allow: true, reason: null };

  // An UNREADABLE record is the most dangerous state, because the safe-looking action is wrong: a
  // phrase may well exist and be in use. Refused regardless of the confirmation flag, because
  // confirming "I accept losing snapshots made with the old phrase" is not informed consent when
  // nobody can say what the old phrase was.
  if (record.error) {
    return {
      allow: false,
      reason: `There is a phrase record here and it cannot be read (${record.error}). `
        + 'Fix or move it by hand before generating anything — a new phrase would orphan every '
        + 'snapshot taken with whatever the old one was.',
    };
  }
  if (!confirmed) {
    return {
      allow: false,
      reason: `A recovery phrase already exists (${record.fingerprint}`
        + `${record.createdAt ? `, made ${record.createdAt}` : ''}). Generating another does not `
        + 'replace it — it ORPHANS every snapshot taken with the old one, silently and permanently. '
        + 'If that is really what you want, pass --i-accept-orphaning-old-snapshots.',
    };
  }
  return { allow: true, reason: null };
}

/**
 * The exact text to be written. A function rather than an inline object so the suite can assert the
 * SHAPE — specifically that it has three fields and none of them is the secret.
 */
function recordText(fingerprint, now = () => new Date().toISOString()) {
  if (typeof fingerprint !== 'string' || fingerprint === '') {
    throw new Error('matsyaPhraseRecord: a fingerprint is required');
  }
  return `${JSON.stringify({ format: FORMAT, fingerprint, createdAt: now() }, null, 2)}\n`;
}

/**
 * Does the phrase master just typed match the one on record?
 *
 * Three outcomes, not two, because "there is no record to compare against" is not the same answer as
 * "that is the wrong phrase" and telling him the second when the first is true would send him
 * looking for a different piece of paper.
 *
 * @returns {{status:'match'|'mismatch'|'no-record', message:string}}
 */
function compare(record, fingerprint) {
  if (!record || record.present !== true || record.error || !record.fingerprint) {
    return {
      status: 'no-record',
      message: 'That phrase is well-formed, but there is no record here to compare it against, '
        + 'so nothing can confirm it is the one your snapshots were made with.',
    };
  }
  if (record.fingerprint === fingerprint) {
    return { status: 'match', message: `That is the phrase on record (${fingerprint}).` };
  }
  return {
    status: 'mismatch',
    message: `That phrase is well-formed but it is NOT the one on record. Typed: ${fingerprint}. `
      + `On record: ${record.fingerprint}.`,
  };
}

module.exports = { readRecord, judgeNew, recordText, compare, FORMAT };
