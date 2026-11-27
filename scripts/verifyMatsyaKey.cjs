'use strict';

/**
 * verifyMatsyaKey.cjs — the recovery phrase, and the claim Section 193 could not yet prove
 * (spec Section 202, answering 192.5).
 *
 * WHAT IS BEING GUARDED. Master's answer to 192.5 was a phrase written down offline, which makes
 * that paper the ONLY way back if the machine dies. Two things therefore have to be true and stay
 * true: a phrase he copied by hand must still open the backup, and a phrase he copied *wrongly* must
 * be refused at the moment he checks it rather than at the moment he needs it.
 *
 * The round trip here is the one 193 described and could not run: encrypt with a key derived from a
 * phrase, with the vault LOCKED, then recover the salt from the ciphertext itself and open it again —
 * which is what "restorable on a machine that has never seen this one" has to mean.
 *
 * Run: node scripts/verifyMatsyaKey.cjs   (or npm run verify:matsya-key)
 */

const crypto = require('crypto');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const mk = require(path.join(ROOT, 'electron/lib/matsyaKey.cjs'));
const cc = require(path.join(ROOT, 'electron/cryptoCore.cjs'));

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

console.log('\nRama Matsya — the recovery phrase, and a restore with nothing but the paper');

// ═══ (1) The phrase a human has to copy ═══════════════════════════════════
section('the phrase is built to be written down and read back');

const g = mk.generatePhrase();
check('a phrase is produced with its fingerprint',
  typeof g.phrase === 'string' && g.secret.length === 20 && /^[0-9A-F-]+$/.test(g.fingerprint));
eq('it is 160 bits of secret', g.secret.length, 20);
check('grouped in fours, so it can be copied and proof-read',
  /^([0-9A-Z]{4}-){8}[0-9A-Z]{2}$/.test(g.phrase), g.phrase);

/*
 * THE ALPHABET IS THE POINT. Crockford base32 excludes I, L, O and U, so there is no pair of
 * characters a person can confuse while copying. A phrase containing one would mean the generator
 * had drifted onto a different alphabet and every phrase written down after that would be ambiguous.
 */
eq('the alphabet excludes every character that can be misread', mk.ALPHABET, '0123456789ABCDEFGHJKMNPQRSTVWXYZ');
for (const bad of ['I', 'L', 'O', 'U']) {
  check(`"${bad}" cannot appear in a phrase`, !mk.ALPHABET.includes(bad));
}

section('reading it back forgives everything that does not change its meaning');

const variants = [
  ['exactly as printed', g.phrase],
  ['in lower case', g.phrase.toLowerCase()],
  ['with spaces instead of dashes', g.phrase.replace(/-/g, ' ')],
  ['with no separators at all', g.phrase.replace(/-/g, '')],
  ['with ragged spacing', ` ${g.phrase.replace(/-/g, '  ')} `],
];
for (const [label, text] of variants) {
  const p = mk.parsePhrase(text);
  check(`${label}: same secret`, p.ok && p.secret.equals(g.secret), p.error);
}

/*
 * THE FOUR CONFUSIONS PEOPLE ACTUALLY MAKE. Crockford's lenient decoding maps O to zero and both I
 * and L to one. Rejecting those would mean a phrase that is correct on paper being refused because
 * of how it was read, which is the worst possible failure for a recovery path.
 *
 * A FIXED SECRET, NOT THE RANDOM ONE ABOVE, and that is the point of this comment. The first version
 * of this row substituted into `g.phrase` — so when the random phrase happened to contain no `0` and
 * no `1`, the substitution changed nothing and the row passed without testing anything. A mutation
 * that deleted lenient decoding entirely was caught on one run and survived the next. A test that
 * depends on luck reports luck.
 *
 * Twenty bytes of zero with a final 1 gives a body of thirty-one `0`s and a `1`: both characters,
 * every time.
 */
const FIXED = Buffer.alloc(20);
FIXED[19] = 1;
const fixed = mk.generatePhrase({ random: () => FIXED });
check('the fixed phrase really contains both confusable digits',
  /0/.test(fixed.phrase) && /1/.test(fixed.phrase), fixed.phrase);
const confused = fixed.phrase.replace(/0/g, 'O').replace(/1/g, 'I');
const pc = mk.parsePhrase(confused);
check('O read for zero and I read for one still open the backup',
  pc.ok && pc.secret.equals(FIXED), pc.error);
const confusedL = fixed.phrase.replace(/1/g, 'L');
check('and L read for one as well',
  mk.parsePhrase(confusedL).ok && mk.parsePhrase(confusedL).secret.equals(FIXED));

section('a phrase copied wrongly is refused when it is checked, not when it is needed');

// REDBY: drop the check characters. A wrong phrase would then derive a perfectly good key that opens
// nothing, and master would find out when he had already lost the machine.
const flip = (s) => {
  const chars = s.replace(/-/g, '').split('');
  chars[5] = chars[5] === 'Z' ? 'Y' : 'Z';
  return chars.join('');
};
const typo = mk.parsePhrase(flip(g.phrase));
check('a single changed character is caught', !typo.ok, 'a typo was accepted');
check('and the message says it is a typo rather than something vague',
  /typo|check/i.test(typo.error || ''), typo.error);

eq('an empty phrase is refused', mk.parsePhrase('').ok, false);
eq('a non-string is refused', mk.parsePhrase(null).ok, false);
eq('a short phrase is refused', mk.parsePhrase('ABCD-EFGH').ok, false);
eq('a long phrase is refused', mk.parsePhrase(`${g.phrase}-ZZZZ`).ok, false);
check('and the length message says what the length should be',
  /34 characters/.test(mk.parsePhrase('ABCD').error || ''), mk.parsePhrase('ABCD').error);

section('the fingerprint names a phrase without revealing it');

eq('the same phrase always gives the same fingerprint', mk.parsePhrase(g.phrase).fingerprint, g.fingerprint);
const g2 = mk.generatePhrase();
check('a different phrase gives a different one', g2.fingerprint !== g.fingerprint);
/*
 * REDBY: derive the fingerprint with the key's own HKDF label. Then publishing it beside a snapshot
 * publishes the first bytes of what opens it.
 *
 * The comparison below uses the SAME salt the fingerprint uses — an empty one — because that is the
 * only way the two could collide. An earlier version of this row compared against a key derived with
 * a random salt, which can never overlap whatever the labels are, so it would have passed even if
 * both used the identical label. The mutation that exposed that is kept in the harness.
 */
const sameSaltKey = mk.deriveKeys(g.secret, Buffer.alloc(32));
const emptySaltKey = Buffer.from(
  crypto.hkdfSync('sha512', g.secret, Buffer.alloc(0), 'rama.matsya.key.v1', 96),
);
const fpHex = g.fingerprint.replace(/-/g, '').toLowerCase();
check('the fingerprint is not the start of the key derived from the same secret',
  !emptySaltKey.toString('hex').startsWith(fpHex)
  && !sameSaltKey.encKey.toString('hex').includes(fpHex)
  && !sameSaltKey.hmacKey.toString('hex').includes(fpHex),
  `fingerprint ${fpHex}`);

// ═══ (2) The keys ═════════════════════════════════════════════════════════
section('the key material fits the envelope that was already audited');

const salt = crypto.randomBytes(32);
const keys = mk.deriveKeys(g.secret, salt);
eq('32 bytes for AES-256', keys.encKey.length, 32);
eq('64 bytes for HMAC-SHA512', keys.hmacKey.length, 64);
check('the two halves are different material', !keys.encKey.equals(keys.hmacKey.slice(0, 32)));
check('the same phrase and salt derive the same keys',
  mk.deriveKeys(g.secret, salt).encKey.equals(keys.encKey));

/*
 * THE SALT MATTERS, and this is why it is a parameter rather than a constant. A fixed salt would
 * work and would mean every installation derived the same key from the same phrase — so one leaked
 * phrase would open every backup ever made with it, anywhere.
 */
check('a different salt derives a different key from the SAME phrase',
  !mk.deriveKeys(g.secret, crypto.randomBytes(32)).encKey.equals(keys.encKey));

check('a secret of the wrong size is refused', (() => {
  try { mk.deriveKeys(Buffer.alloc(8), salt); return false; } catch { return true; }
})());
check('a salt that is too short is refused', (() => {
  try { mk.deriveKeys(g.secret, Buffer.alloc(4)); return false; } catch { return true; }
})());

// ═══ (3) The round trip 193 described and could not run ═══════════════════
section('a restore with nothing but the blob and the paper');

const plaintext = Buffer.from('master private note — this must never appear in a blob', 'utf8');
const blob = cc.encryptBuffer(plaintext, '', { ...keys, salt });

// REDBY: require the vault to be unlocked for an injected key. Matsya has to work when the vault
// cannot be opened — that is the case it exists for.
eq('the vault is NOT unlocked while this happens', cc.isUnlocked(), false);
check('and no plaintext survives into the blob', !blob.includes(Buffer.from('private note')));

const recoveredSalt = cc.saltOf(blob);
check('the salt is recoverable from the ciphertext itself, with no key',
  recoveredSalt !== null && recoveredSalt.equals(salt));
eq('a buffer too short to hold a header yields no salt', cc.saltOf(Buffer.alloc(8)), null);
eq('and neither does a non-buffer', cc.saltOf('nonsense'), null);

// The other machine: it has the blob, and master has the paper. Nothing else.
const typedByHand = mk.parsePhrase(g.phrase.toLowerCase().replace(/-/g, ' '));
const rekeys = { ...mk.deriveKeys(typedByHand.secret, recoveredSalt), salt: recoveredSalt };
const restored = cc.decryptBuffer(blob, '', rekeys);
check('THE BACKUP OPENS WITH NOTHING BUT THE PHRASE, BYTE-IDENTICAL', restored.equals(plaintext));

section('and fails closed when it should');

check('a different phrase cannot open it', (() => {
  const wrong = { ...mk.deriveKeys(g2.secret, recoveredSalt), salt: recoveredSalt };
  try { cc.decryptBuffer(blob, '', wrong); return false; } catch { return true; }
})());
check('a tampered blob is refused rather than returning rubbish', (() => {
  const t = Buffer.from(blob);
  t[t.length - 80] ^= 0x01;
  try { cc.decryptBuffer(t, '', rekeys); return false; } catch { return true; }
})());
/*
 * THE SHAPE CHECK HAS TO BE TESTED WITH SOMETHING NODE WOULD ACCEPT.
 *
 * An earlier version passed a 16-byte `encKey`, and `createCipheriv('aes-256-gcm', …)` rejects that
 * by itself — so the row passed while proving nothing about this module's validation, and deleting
 * the validation outright went unnoticed. `createHmac` accepts a key of ANY length, so a short
 * `hmacKey` is the case that is only caught here.
 */
check('a short HMAC key is refused, which only this module can catch', (() => {
  try { cc.encryptBuffer(plaintext, '', { encKey: keys.encKey, hmacKey: Buffer.alloc(8), salt }); return false; }
  catch { return true; }
})());
check('a short AES key is refused too', (() => {
  try { cc.encryptBuffer(plaintext, '', { encKey: Buffer.alloc(16), hmacKey: keys.hmacKey, salt }); return false; }
  catch { return true; }
})());
check('a salt of the wrong size is refused', (() => {
  try { cc.encryptBuffer(plaintext, '', { ...keys, salt: Buffer.alloc(8) }); return false; }
  catch { return true; }
})());

/*
 * AND THE ORIGINAL PATH STILL REQUIRES AN UNLOCKED VAULT. Making the key a parameter must not have
 * made the key OPTIONAL: with neither an injected key nor an unlocked vault there is nothing to
 * encrypt with, and the only safe outcome is a refusal. Nothing asserted this until a mutation
 * removed the check and no suite noticed.
 */
/*
 * THE MESSAGE IS ASSERTED, NOT JUST THE REFUSAL, because both outcomes refuse.
 *
 * Remove the `!_unlocked` guard and the call still fails — `createCipheriv` will not accept a null
 * key — so a row that only checks "it threw" passes either way, which is how a mutation deleting the
 * guard survived. What the guard actually buys is a legible reason: "not unlocked" tells a caller
 * what to do, where a cryptic error from deep inside the cipher does not.
 */
const lockedEncrypt = (() => {
  try { cc.encryptBuffer(plaintext); return null; } catch (e) { return e.message; }
})();
check('with no injected key and a locked vault, encryption refuses', lockedEncrypt !== null);
check('and says the vault is not unlocked rather than failing cryptically',
  /not unlocked/i.test(lockedEncrypt || ''), lockedEncrypt);

const lockedDecrypt = (() => {
  try { cc.decryptBuffer(blob); return null; } catch (e) { return e.message; }
})();
check('decryption refuses too', lockedDecrypt !== null);
check('with the same legible reason', /not unlocked/i.test(lockedDecrypt || ''), lockedDecrypt);

// ═══ (4) What this module must never learn to do ══════════════════════════
section('contained: the key module cannot store, read or send anything');

const src = require('fs').readFileSync(path.join(ROOT, 'electron/lib/matsyaKey.cjs'), 'utf8');
const stripped = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
check('it requires nothing but crypto', (stripped.match(/require\(/g) || []).length === 1
  && /require\('crypto'\)/.test(stripped));
check('no filesystem', !/readFile|writeFile|existsSync|mkdir|unlink/.test(stripped));
check('no network', !/http|net'|fetch\(|request\(/.test(stripped));
check('no process spawning', !/child_process|spawn|exec/.test(stripped));
// REDBY: cache the derived key "to avoid re-deriving it". The phrase is the only copy by design, and
// a module-level key is a copy that outlives the call and can be read by anything in the process.
check('it keeps no module-level key or phrase state',
  !/^(let|var)\s/m.test(stripped), 'module-level mutable state found');
check('no console.log', !/console\.log/.test(src));

console.log('\n  held by hand, listed rather than implied:');
console.log('    - the two check characters are 10 bits, so about one transcription error in a');
console.log('      thousand still parses. They catch a slip, they are not a security control');
console.log('    - HKDF is correct here BECAUSE the input is 160 random bits. If a phrase ever');
console.log('      becomes something master chooses himself, this must change to Argon2id');
console.log('    - nothing here proves master wrote the phrase down, or that the paper still');
console.log('      exists. That is the one part of this design no code can verify');

console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'} — ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
