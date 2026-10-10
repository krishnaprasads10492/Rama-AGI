#!/usr/bin/env node
/**
 * verifyCredentialVault.cjs — the credential vault, exercised rather than read.
 *
 * WHY THIS IS BEHAVIOURAL AND NOT A SOURCE GREP (spec Section 141). Master
 * reported that the Models page asked for his master password again and then did
 * not unlock. Reading the source made it look fine: the handler derived a key,
 * loaded the vault and returned `{ ok: true }`. Running it exposed four defects
 * that no amount of reading would have settled, because every one of them is a
 * property of a SEQUENCE — unlock, write, lock, unlock — and not of a function:
 *
 *   1. `saveVault()` wrote `{ enc, hmac }`, so THE FIRST CREDENTIAL SAVED
 *      DELETED THE SALT that was stored in the same file.
 *   2. The next unlock found no salt, minted a fresh random one, derived a
 *      different key, failed the integrity check, SWALLOWED the error and
 *      returned `{ ok: true }` with an empty vault. Every stored key was gone,
 *      and the new salt was written back, making recovery impossible.
 *   3. ANY password "unlocked" the vault. Nothing verified the derived key, so a
 *      wrong password produced an empty unlocked vault — and the next write
 *      persisted that over master's real credentials.
 *   4. The renderer checked `if (res.ok)` with no else, so a failure was a dead
 *      button.
 *
 * The vault is the most data-critical module in the repository: it is the only
 * place a lost byte cannot be recomputed. So the rows below are a lifecycle, run
 * against a THROWAWAY home directory — `credentialVault.cjs` falls back to
 * `os.homedir()/.rama-agi` when Electron's `app` is absent, which is what makes
 * it testable outside Electron at all. Master's real vault is never touched; the
 * first assertion proves the redirection took.
 *
 * Run: node scripts/verifyCredentialVault.cjs   (or npm run verify:vault)
 */
'use strict';

const os     = require('os');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

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

// ── Redirect HOME before the module under test resolves its own paths ────────
const REAL_HOME = os.homedir();
const SANDBOX   = fs.mkdtempSync(path.join(os.tmpdir(), 'rama-vault-verify-'));
process.env.USERPROFILE = SANDBOX;
process.env.HOME        = SANDBOX;

const ROOT  = path.resolve(__dirname, '..');
const vault = require(path.join(ROOT, 'electron', 'ipc', 'credentialVault.cjs'));

const handlers = new Map();
vault.register({ handle: (ch, fn) => handlers.set(ch, fn) });
const call = (ch, payload) => handlers.get(ch)(null, payload);

const MASTER = { id: 'master', name: 'Krishna Prasad', tier: 0 };
const PW     = 'a master password with spaces and §ymbols';
const dirOf  = (home) => path.join(home, '.rama-agi');
const encOf  = (home) => path.join(dirOf(home), 'rama_vault.enc');
const saltOf = (home) => path.join(dirOf(home), 'rama_vault.salt');

(async () => {
  console.log('\nRama credential vault — a lifecycle, not a source read');

  // ── (0) the sandbox really is a sandbox ────────────────────────────────────
  check('the test home is a throwaway directory, not master\'s own',
    SANDBOX !== REAL_HOME && SANDBOX.startsWith(os.tmpdir()), SANDBOX);
  check('and os.homedir() now resolves into it, so the module cannot reach the real vault',
    os.homedir() === SANDBOX, `${os.homedir()} vs ${SANDBOX}`);

  // ── (1) the channels exist ────────────────────────────────────────────────
  for (const ch of ['vault:unlock', 'vault:lock', 'vault:status', 'vault:set',
    'vault:get', 'vault:list', 'vault:delete', 'vault:has']) {
    check(`${ch} is registered`, handlers.has(ch));
  }

  // ── (2) the capability gate, which is NOT the defect but must stay shut ───
  console.log('\n  the gate: tier 0 only');
  eq('a tier-3 operator may not unlock',
    (await call('vault:unlock', { user: { id: 'g', tier: 3 }, password: PW })).ok, false);
  eq('an unauthenticated caller may not unlock',
    (await call('vault:unlock', { user: null, password: PW })).ok, false);
  eq('a user whose tier is a STRING is refused, not coerced',
    (await call('vault:unlock', { user: { id: 'x', tier: '0' }, password: PW })).ok, false);
  eq('a tier-3 operator may not read',
    (await call('vault:get', { user: { id: 'g', tier: 3 }, service: 'anything' })).ok, false);

  // ── (3) an empty password is refused rather than derived from ─────────────
  console.log('\n  a password is required');
  eq('an empty password is refused', (await call('vault:unlock', { user: MASTER, password: '' })).ok, false);
  eq('a missing password is refused', (await call('vault:unlock', { user: MASTER })).ok, false);
  eq('a non-string password is refused',
    (await call('vault:unlock', { user: MASTER, password: 12345 })).ok, false);
  // REDBY: mint a salt before checking the password. A refused unlock must not
  // create state, or an empty vault starts existing because someone mis-clicked.
  eq('and none of those created a salt file', fs.existsSync(saltOf(SANDBOX)), false);

  // ── (4) first unlock, then the sequence that used to destroy the vault ────
  console.log('\n  THE LIFECYCLE: unlock, write, lock, unlock');
  const u1 = await call('vault:unlock', { user: MASTER, password: PW });
  eq('a first unlock on a fresh vault succeeds', u1.ok, true);
  eq('and reports itself as fresh', u1.fresh, true);
  eq('and holds nothing yet', u1.entries, 0);
  check('the salt is written to its OWN file', fs.existsSync(saltOf(SANDBOX)));

  eq('a credential can be stored',
    (await call('vault:set', { user: MASTER, service: 'ollama-cloud', value: 'sk-secret-1',
      meta: { label: 'Ollama' } })).ok, true);

  // THE ROW THAT WOULD HAVE CAUGHT THE DATA LOSS.
  // REDBY: write the vault blob without preserving the salt (the original bug),
  // or move the salt back inside that blob.
  const blob = JSON.parse(fs.readFileSync(encOf(SANDBOX), 'utf8'));
  check('the salt file SURVIVES a write', fs.existsSync(saltOf(SANDBOX)));
  eq('and the salt is not inside the blob, where a rewrite could drop it',
    Object.prototype.hasOwnProperty.call(blob, 'salt'), false);
  check('the blob carries a verifier', typeof blob.verifier === 'string' && blob.verifier.length > 0);
  check('and ciphertext and an hmac', typeof blob.enc === 'string' && typeof blob.hmac === 'string');
  check('the plaintext secret is NOWHERE in the file',
    !fs.readFileSync(encOf(SANDBOX), 'utf8').includes('sk-secret-1'));

  eq('lock succeeds', (await call('vault:lock', { user: MASTER })).ok, true);
  eq('and a locked vault refuses reads',
    (await call('vault:get', { user: MASTER, service: 'ollama-cloud' })).ok, false);

  const u2 = await call('vault:unlock', { user: MASTER, password: PW });
  eq('the SAME password unlocks the vault again', u2.ok, true);
  eq('it is no longer fresh', u2.fresh, false);
  // THIS is the defect master hit: the key used to be gone here.
  const g2 = await call('vault:get', { user: MASTER, service: 'ollama-cloud' });
  eq('and the stored credential is STILL THERE', g2.value, 'sk-secret-1');
  eq('its metadata survived too', g2.meta?.label, 'Ollama');
  eq('has() agrees', (await call('vault:has', { user: MASTER, service: 'ollama-cloud' })).has, true);
  eq('list() names it without exposing the value',
    JSON.stringify((await call('vault:list', { user: MASTER })).data
      .map((r) => [r.service, r.hasValue])), JSON.stringify([['ollama-cloud', true]]));

  // ── (5) a wrong password must FAIL, and must not damage anything ──────────
  console.log('\n  a wrong password is refused, and changes nothing');
  await call('vault:lock', { user: MASTER });
  const fileBefore = fs.readFileSync(encOf(SANDBOX), 'utf8');
  const bad = await call('vault:unlock', { user: MASTER, password: 'not the password' });
  // REDBY: set `vaultUnlocked = true` before the verifier is checked.
  eq('a wrong password does NOT unlock', bad.ok, false);
  check('and says so rather than returning silence', /password/i.test(bad.error || ''), bad.error);
  eq('the vault reports itself still locked',
    (await call('vault:status', {})).unlocked, false);
  eq('a write while in that state is refused',
    (await call('vault:set', { user: MASTER, service: 'intruder', value: 'x' })).ok, false);
  eq('and the file on disk is byte-for-byte unchanged',
    fs.readFileSync(encOf(SANDBOX), 'utf8'), fileBefore);
  const u3 = await call('vault:unlock', { user: MASTER, password: PW });
  eq('the correct password still works afterwards', u3.ok, true);
  eq('and the credential is intact',
    (await call('vault:get', { user: MASTER, service: 'ollama-cloud' })).value, 'sk-secret-1');

  // ── (6) status tells the three states apart ──────────────────────────────
  console.log('\n  status distinguishes three states, not two');
  const st = await call('vault:status', {});
  eq('an unlocked vault says so', st.unlocked, true);
  eq('it reports a file exists', st.exists, true);
  eq('and is not flagged unreadable', st.unreadable, false);
  check('status exposes no service names and no values',
    !Object.keys(st).some((k) => /service|value|data|key/i.test(k)), Object.keys(st).join(','));

  // ── (7) delete ───────────────────────────────────────────────────────────
  eq('a credential can be deleted',
    (await call('vault:delete', { user: MASTER, service: 'ollama-cloud' })).ok, true);
  eq('and is then absent', (await call('vault:has', { user: MASTER, service: 'ollama-cloud' })).has, false);
  await call('vault:lock', { user: MASTER });
  await call('vault:unlock', { user: MASTER, password: PW });
  eq('the deletion persisted across a lock',
    (await call('vault:has', { user: MASTER, service: 'ollama-cloud' })).has, false);

  // ── (8) MIGRATION: a legacy vault whose salt is still inside the blob ────
  //
  // This is the one pre-Section-141 vault that is still recoverable, so the
  // migration is worth asserting rather than assuming.
  console.log('\n  migration: a legacy vault that still carries its salt');
  const LEGACY = fs.mkdtempSync(path.join(os.tmpdir(), 'rama-vault-legacy-'));
  process.env.USERPROFILE = LEGACY;
  process.env.HOME        = LEGACY;
  fs.mkdirSync(dirOf(LEGACY), { recursive: true });
  const lSalt = crypto.randomBytes(32).toString('hex');
  let lKey;
  try {
    const argon2 = require('argon2');
    lKey = await argon2.hash(PW, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3,
      parallelism: 2, hashLength: 32, salt: Buffer.from(lSalt, 'hex'), raw: true });
  } catch {
    lKey = crypto.scryptSync(PW, lSalt, 32, { N: 16384, r: 8, p: 1 });
  }
  const iv  = crypto.randomBytes(12);
  const cip = crypto.createCipheriv('aes-256-gcm', lKey, iv);
  const payload = JSON.stringify({ version: 1,
    data: { 'legacy-provider': { value: 'sk-legacy-9', meta: {}, addedAt: 1 } } });
  const bodyBuf = Buffer.concat([cip.update(payload, 'utf8'), cip.final()]);
  const lEnc  = Buffer.concat([iv, cip.getAuthTag(), bodyBuf]).toString('base64');
  const lHmac = crypto.createHmac('sha512', lKey).update(lEnc).digest('hex');
  // The legacy shape exactly: salt inside, no verifier.
  fs.writeFileSync(encOf(LEGACY), JSON.stringify({ salt: lSalt, enc: lEnc, hmac: lHmac }), 'utf8');

  await call('vault:lock', { user: MASTER });
  const mig = await call('vault:unlock', { user: MASTER, password: PW });
  eq('a legacy vault still opens', mig.ok, true);
  eq('and its credential is recovered',
    (await call('vault:get', { user: MASTER, service: 'legacy-provider' })).value, 'sk-legacy-9');
  check('the salt is copied out to its own file', fs.existsSync(saltOf(LEGACY)));
  eq('a wrong password against a legacy vault is still refused',
    await (async () => {
      await call('vault:lock', { user: MASTER });
      return (await call('vault:unlock', { user: MASTER, password: 'wrong' })).ok;
    })(), false);

  // ── (9) THE DAMAGED CASE: ciphertext with no salt anywhere ───────────────
  //
  // This is what the old bug left on disk. It is unrecoverable by construction —
  // no password can derive a key without the salt — so the only thing that
  // matters is that Rama says so and makes it NO WORSE.
  console.log('\n  a vault whose salt was already destroyed');
  const BROKEN = fs.mkdtempSync(path.join(os.tmpdir(), 'rama-vault-broken-'));
  process.env.USERPROFILE = BROKEN;
  process.env.HOME        = BROKEN;
  fs.mkdirSync(dirOf(BROKEN), { recursive: true });
  fs.writeFileSync(encOf(BROKEN), JSON.stringify({ enc: lEnc, hmac: lHmac }), 'utf8');
  const brokenBefore = fs.readFileSync(encOf(BROKEN), 'utf8');

  await call('vault:lock', { user: MASTER });
  const dead = await call('vault:unlock', { user: MASTER, password: PW });
  eq('it refuses rather than reporting success', dead.ok, false);
  eq('and flags itself unreadable', dead.unreadable, true);
  check('the message says the keys cannot be recovered rather than implying a typo',
    /cannot be recovered/.test(dead.error || ''), dead.error);
  // REDBY: mint a fresh salt when ciphertext is present. That is the original
  // bug, and it is what made the loss permanent instead of merely inconvenient.
  eq('NO new salt is minted over it', fs.existsSync(saltOf(BROKEN)), false);
  eq('the ciphertext is left untouched', fs.readFileSync(encOf(BROKEN), 'utf8'), brokenBefore);
  eq('and a write is refused rather than overwriting it',
    (await call('vault:set', { user: MASTER, service: 'x', value: 'y' })).ok, false);
  eq('the file is STILL untouched after that attempt',
    fs.readFileSync(encOf(BROKEN), 'utf8'), brokenBefore);

  // ── (10) the direct (non-IPC) writers share the same refusal ─────────────
  console.log('\n  the direct writers are not a looser second path');
  eq('setCredentialDirect refuses while locked',
    vault.setCredentialDirect('x', 'y').ok, false);
  eq('deleteCredentialDirect refuses while locked',
    vault.deleteCredentialDirect('x').ok, false);
  eq('getCredential returns null while locked', vault.getCredential('x'), null);
  eq('isUnlocked agrees', vault.isUnlocked(), false);

  // ── (11) what the renderer must not do again ─────────────────────────────
  //
  // The main process returned a reason the whole time; the page threw it away.
  // Asserted at source because it is a rendering behaviour, not arithmetic.
  console.log('\n  the Models page reports a failed unlock');
  const page = fs.readFileSync(path.join(ROOT, 'src', 'pages', 'Models', 'Models.jsx'), 'utf8');
  check('unlockVault has a failure branch at all', /setVaultError\(/.test(page));
  check('it surfaces the error the main process returned', /res\?\.error/.test(page));
  check('it catches a rejected invoke rather than dying silently',
    /catch \(err\)[\s\S]{0,220}could not be reached/.test(page));
  // REDBY: go back to Promise.all. One rejected channel then strands the banner
  // on its initial `true`, and no correct password can clear it.
  check('the page loads its six reads with allSettled, not all',
    /Promise\.allSettled\(/.test(page) && !/Promise\.all\(\[/.test(page));
  check('the banner tells the three vault states apart',
    /vaultState\.unreadable/.test(page) && /vaultState\.exists/.test(page));
  check('and it explains that this is a SECOND store with its own password',
    /separate encrypted file/.test(page));

  // ── Cleanup ──────────────────────────────────────────────────────────────
  process.env.USERPROFILE = REAL_HOME;
  process.env.HOME        = REAL_HOME;
  for (const d of [SANDBOX, LEGACY, BROKEN]) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ }
  }
  check('every throwaway directory was removed',
    [SANDBOX, LEGACY, BROKEN].every((d) => !fs.existsSync(d)));

  console.log('\n  held by hand, listed rather than implied:');
  console.log('    - that Argon2id is preferred and scrypt is only a fallback is asserted by neither');
  console.log('      row above: both derive a usable key, and which one ran depends on whether the');
  console.log('      native module loaded. The lifecycle is identical either way, which is the point');
  console.log('    - WHETHER the vault should share the startup passcode is a DESIGN question raised');
  console.log('      in Section 141 for master, not a defect. These rows assert the two-secret design');
  console.log('      that exists; they do not endorse it');
  console.log('    - a vault damaged before Section 141 stays damaged. No row can assert recovery of');
  console.log('      data whose salt was overwritten, and none pretends to');

  console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'} — ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((err) => {
  console.error(`\nverifyCredentialVault crashed: ${err && err.stack ? err.stack : err}\n`);
  process.exit(1);
});
