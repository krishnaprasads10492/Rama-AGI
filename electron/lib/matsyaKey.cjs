'use strict';

/**
 * matsyaKey.cjs — the recovery phrase that can restore a backup on a machine that has never seen
 * this one (Section 202, answering 192.5).
 *
 * MASTER CHOSE (b): a phrase generated once and written down offline. 192.5 rejected the machine key
 * because a dead machine takes it with it, and his passcode because a backup should survive him
 * forgetting it. So the key lives on paper and nowhere else — this module never writes anything.
 *
 * ── WHY NOT BIP39 ──────────────────────────────────────────────────────────
 * Words are easier to write down than characters, and BIP39 is the standard. It needs a 2,048-word
 * list, which would have to come from somewhere and then be shipped and trusted, and a
 * half-implemented BIP39 — wrong checksum bits, or PBKDF2 with the wrong iteration count — is worse
 * than a correct simpler scheme, because it LOOKS like the standard to anyone who checks.
 *
 * So: Crockford base32. The alphabet excludes I, L, O and U, so no character can be misread as
 * another; decoding is lenient about the confusions people make anyway (O→0, I and L→1) and about
 * case and separators; and the phrase is grouped in fours so it can be copied by hand and
 * proof-read. Two check characters catch a transcription error before it becomes an unrestorable
 * backup.
 *
 * ── WHY HKDF AND NOT ARGON2, WHICH THIS PROJECT ALREADY DEPENDS ON ─────────
 * This is the decision most likely to be "corrected" later by someone who knows the vault uses
 * Argon2id at 128 MiB, so the reasoning is written down.
 *
 * A slow KDF exists to make GUESSING expensive. It is the right answer for `cryptoCore`, where the
 * input is a passcode a human invented and an attacker can try a billion of them. **This input is
 * 160 bits of `crypto.randomBytes`.** There is nothing to guess: no amount of hardware searches a
 * 160-bit space, so Argon2 here would buy exactly nothing and charge 128 MiB and a second of restore
 * time for it — on the one code path master runs when something has already gone badly wrong.
 *
 * HKDF-SHA512 is the correct primitive for the actual job: expand one high-entropy secret into two
 * independent keys. Different problem, different tool. `cryptoCore` keeps Argon2 for the passcode.
 *
 * ── WHAT THIS MODULE REFUSES TO DO ────────────────────────────────────────
 * It does not read or write files, touch the vault, or cache the derived key. It requires nothing
 * but `crypto`. The phrase arrives as an argument and leaves as key material; where that key is used
 * is `matsyaSnapshot`'s business, and where the phrase is kept is master's.
 */

const crypto = require('crypto');

/** Crockford base32: no I, L, O or U, so nothing can be misread as something else. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const SECRET_BYTES = 20;          // 160 bits
const GROUP = 4;
const CHECK_CHARS = 2;

/** The confusions a person actually makes when copying by hand, accepted on the way back in. */
const LENIENT = { O: '0', I: '1', L: '1', U: 'V' };

function toBase32(buf) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function fromBase32(str) {
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of str) {
    const idx = ALPHABET.indexOf(ch);
    if (idx === -1) return null;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/**
 * Two characters derived from the secret itself. Ten bits, so roughly one transcription error in a
 * thousand survives — enough to catch a slip while writing it down, which is the error that matters,
 * and it is NOT a security control: an attacker with the phrase does not need the check digits.
 */
function checkChars(secret) {
  const h = crypto.createHash('sha256').update(secret).digest();
  return toBase32(Buffer.from([h[0], h[1]])).slice(0, CHECK_CHARS);
}

/** `ABCD-EFGH-…-XY`, the last group being the check characters. */
function format(secret) {
  const body = toBase32(secret);
  const groups = body.match(new RegExp(`.{1,${GROUP}}`, 'g')) || [];
  return [...groups, checkChars(secret)].join('-');
}

/**
 * Make a phrase. `random` is injectable so a suite can drive known bytes; the default is the only
 * one the application uses.
 *
 * @returns {{phrase:string, secret:Buffer, fingerprint:string}}
 */
function generatePhrase({ random = crypto.randomBytes } = {}) {
  const secret = Buffer.from(random(SECRET_BYTES));
  if (secret.length !== SECRET_BYTES) {
    throw new Error(`matsyaKey: need ${SECRET_BYTES} random bytes, got ${secret.length}`);
  }
  return { phrase: format(secret), secret, fingerprint: fingerprint(secret) };
}

/**
 * Read a phrase back, forgiving everything that does not change its meaning: case, spaces, dashes,
 * and the four character confusions above.
 *
 * @returns {{ok:true, secret:Buffer, fingerprint:string} | {ok:false, error:string}}
 */
function parsePhrase(phrase) {
  if (typeof phrase !== 'string' || phrase.trim() === '') {
    return { ok: false, error: 'No recovery phrase was given' };
  }
  const cleaned = phrase
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .split('')
    .map((c) => LENIENT[c] ?? c)
    .join('');

  const expectedBody = Math.ceil((SECRET_BYTES * 8) / 5);   // 32 characters for 160 bits
  if (cleaned.length !== expectedBody + CHECK_CHARS) {
    return {
      ok: false,
      error: `A recovery phrase is ${expectedBody + CHECK_CHARS} characters; this one has ${cleaned.length}`,
    };
  }

  const body = cleaned.slice(0, expectedBody);
  const given = cleaned.slice(expectedBody);
  const decoded = fromBase32(body);
  if (!decoded) return { ok: false, error: 'The phrase contains a character that is not part of one' };

  const secret = decoded.slice(0, SECRET_BYTES);
  if (secret.length !== SECRET_BYTES) return { ok: false, error: 'The phrase is incomplete' };

  // CHECKED BEFORE ANYTHING IS DERIVED. A wrong phrase that still derives a key produces a snapshot
  // nobody can open, discovered at the worst possible moment.
  if (checkChars(secret) !== given) {
    return { ok: false, error: 'That phrase has a typo in it — the check characters do not match' };
  }
  return { ok: true, secret, fingerprint: fingerprint(secret) };
}

/**
 * A short, public name for a phrase, so master can confirm that the paper in his hand belongs to the
 * snapshot in front of him WITHOUT either of them revealing the other.
 *
 * Derived through HKDF with its own `info` label, so it is not a truncation of the key it accompanies
 * — the two outputs are independent, and publishing one says nothing about the other.
 */
function fingerprint(secret) {
  const out = crypto.hkdfSync('sha512', secret, Buffer.alloc(0), 'rama.matsya.fingerprint.v1', 8);
  return Buffer.from(out).toString('hex').toUpperCase().match(/.{4}/g).join('-');
}

/**
 * The two keys `cryptoCore`'s envelope wants, in the shape it already uses: 32 bytes for AES-256-GCM
 * and 64 for HMAC-SHA512.
 *
 * The salt is a parameter rather than a constant because a snapshot stores its own salt in its blob
 * headers (Section 193), which is what makes the ciphertext self-describing and restorable on a
 * machine that has never seen this one. A fixed salt would work and would mean every installation
 * derived the same key from the same phrase.
 *
 * @param {Buffer} secret 20 bytes from `parsePhrase` or `generatePhrase`
 * @param {Buffer} salt   32 bytes, stored alongside the ciphertext
 */
function deriveKeys(secret, salt) {
  if (!Buffer.isBuffer(secret) || secret.length !== SECRET_BYTES) {
    throw new Error('matsyaKey: a 20-byte secret is required');
  }
  if (!Buffer.isBuffer(salt) || salt.length < 16) {
    throw new Error('matsyaKey: a salt of at least 16 bytes is required');
  }
  const material = Buffer.from(
    crypto.hkdfSync('sha512', secret, salt, 'rama.matsya.key.v1', 96),
  );
  return { encKey: material.slice(0, 32), hmacKey: material.slice(32, 96) };
}

module.exports = {
  generatePhrase,
  parsePhrase,
  deriveKeys,
  fingerprint,
  ALPHABET,
  SECRET_BYTES,
};
