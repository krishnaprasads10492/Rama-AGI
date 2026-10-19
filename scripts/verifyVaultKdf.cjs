'use strict';
/**
 * verifyVaultKdf.cjs - the vault says which key derivation sealed it, and never swaps it silently (spec Section 159)
 *
 * Run against a THROWAWAY home directory (the vault falls back to os.homedir()/.rama-agi when Electron's `app` is
 * absent, which is what makes it testable at all). The Argon2 module is made "missing" by intercepting the load,
 * so the case that used to corrupt the meaning of a password is exercised for real:
 *
 *   SAME PASSWORD, SAME KEY   a vault opens under the derivation that sealed it, whatever is installed now
 *   MISSING IS NOT WRONG      a missing module is reported as a missing module, and nothing is touched
 *   NEVER SILENT             a vault on the weaker fallback says so, before and after unlock, and stays on it
 *   OLD VAULTS STILL OPEN     a vault with no record opens whichever way it was sealed
 *
 * Run: node scripts/verifyVaultKdf.cjs   (or npm run verify:vault-kdf)
 */
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Module = require('module');
const ROOT = path.resolve(__dirname, '..');
let pass = 0;
let fail = 0;
function check(label, ok, detail) {
  if (ok) { pass += 1; console.warn(`  PASS  ${label}`); } else { fail += 1; console.warn(`  FAIL  ${label}${detail ? ` - ${detail}` : ''}`); }
}
const section = (t) => console.warn(`\n--- ${t} ---`);
let finished = false;
process.on('exit', () => { if (!finished) { console.warn('  FAIL  the suite did not reach its summary (something never settled)'); process.exitCode = 1; } });

// ── "the argon2 module is not installed", for real: the load itself fails ──────────────────────────
let argonBlocked = false;
const origLoad = Module._load;
Module._load = function patched(request, ...rest) {
  if (argonBlocked && request === 'argon2') { const e = new Error("Cannot find module 'argon2'"); e.code = 'MODULE_NOT_FOUND'; throw e; }
  return origLoad.call(this, request, ...rest);
};
// Count derivations, so "a recorded vault costs one, a legacy wrong password costs two" is measured, not read.
const argon2 = require('argon2');
const realHash = argon2.hash;
let argonCalls = 0;
argon2.hash = (...a) => { argonCalls += 1; return realHash.apply(argon2, a); };
const realScrypt = crypto.scrypt;
let scryptCalls = 0;
crypto.scrypt = (...a) => { scryptCalls += 1; return realScrypt.apply(crypto, a); };
const counts = () => ({ a: argonCalls, s: scryptCalls });
const resetCounts = () => { argonCalls = 0; scryptCalls = 0; };

const sandboxes = [];
function newHome() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'rama-vault-kdf-'));
  sandboxes.push(d);
  process.env.USERPROFILE = d;
  process.env.HOME = d;
  return d;
}
const first = newHome();
const vault = require(path.join(ROOT, 'electron', 'ipc', 'credentialVault.cjs'));
const handlers = new Map();
vault.register({ handle: (ch, fn) => handlers.set(ch, fn) });
const call = (ch, payload) => handlers.get(ch)(null, payload);
const MASTER = { id: 'master', name: 'Krishna Prasad', tier: 0 };
const PW = 'a master password with spaces and §ymbols';
const OTHER = 'a different password';
const rnd = (tag) => `${tag}-${crypto.randomBytes(12).toString('hex')}`;
const SECRET1 = rnd('one');
const SECRET2 = rnd('two');
const SECRET3 = rnd('three');
const fileOf = (home) => path.join(home, '.rama-agi', 'rama_vault.enc');
const header = (home) => JSON.parse(fs.readFileSync(fileOf(home), 'utf8'));
const digest = (home) => crypto.createHash('sha256').update(fs.readFileSync(fileOf(home))).digest('hex');
const unlock = (pw = PW) => call('vault:unlock', { user: MASTER, password: pw });
const status = () => call('vault:status', {});
const set = (svc, val) => call('vault:set', { user: MASTER, service: svc, value: val });
const get = (svc) => call('vault:get', { user: MASTER, service: svc });
const lock = () => call('vault:lock', { user: MASTER });
// Rewrite the header of a stored vault without touching its ciphertext (to build "old" or "hostile" vaults).
const rewrite = (home, fn) => { const h = header(home); fn(h); fs.writeFileSync(fileOf(home), JSON.stringify(h)); };

(async () => {
  console.warn('\nvault key derivation - named in the file, never swapped silently\n');
  check('the sandbox is a throwaway directory and the module resolves into it', os.homedir() === first && first.startsWith(os.tmpdir()));

  // ═══ 1. a new vault, Argon2 present ════════════════════════════════════════════════════════════
  section('a new vault with Argon2 present');
  let st = await status();
  check('before it exists: it says what a new vault WOULD use, and it is not weak', st.ok && st.exists === false && st.kdf === 'argon2id' && st.weakKdf === false);
  let u = await unlock();
  check('it opens fresh and reports Argon2id', u.ok && u.fresh === true && u.kdf === 'argon2id' && u.weakKdf === false);
  check('and a credential can be stored', (await set('SVC_ONE', SECRET1)).ok === true);
  check('the file NAMES the derivation', header(first).kdf === 'argon2id');
  check('the file holds no credential and no password in the clear', (() => { const t = fs.readFileSync(fileOf(first), 'utf8'); return !t.includes(SECRET1) && !t.includes(PW); })());
  await lock();
  st = await status();
  check('LOCKED, status still reports the derivation (the header is not secret)', st.kdf === 'argon2id' && st.weakKdf === false && st.unlocked === false);
  resetCounts();
  u = await unlock();
  check('it reopens, and the stored credential is intact', u.ok && (await get('SVC_ONE')).value === SECRET1);
  check('a recorded vault costs exactly ONE derivation', counts().a === 1 && counts().s === 0, JSON.stringify(counts()));
  await lock();
  resetCounts();
  const wrongRec = await unlock(OTHER);
  check('a wrong password on a recorded vault is "wrong master password" after ONE derivation', wrongRec.ok === false && /wrong master password/.test(wrongRec.error) && counts().a === 1 && counts().s === 0, JSON.stringify([wrongRec.error, counts()]));
  check('and it is not unlocked', (await status()).unlocked === false);

  // ═══ 2. the module goes missing ════════════════════════════════════════════════════════════════
  section('the Argon2 module is missing, the vault was sealed with it');
  await lock();
  const before = digest(first);
  argonBlocked = true;
  resetCounts();
  st = await status();
  check('status still reports Argon2id from the header, not weak', st.kdf === 'argon2id' && st.weakKdf === false);
  const miss = await unlock();
  check('unlock is refused', miss.ok === false && miss.unreadable === true);
  check('and it says the MODULE is missing, flagged as such', miss.kdfMissing === true && /Argon2id/.test(miss.error) && /argon2 module/.test(miss.error));
  check('and it does NOT call this a wrong password', !/wrong master password/i.test(miss.error));
  check('no key was derived with the wrong function', counts().a === 0 && counts().s === 0, JSON.stringify(counts()));
  check('the vault file is byte-for-byte unchanged', digest(first) === before);
  check('writes stay blocked', (await set('SVC_TWO', SECRET2)).ok === false);
  check('and the file is still unchanged after the attempted write', digest(first) === before);
  check('status marks it unreadable rather than empty', (await status()).unreadable === true);
  argonBlocked = false;
  u = await unlock();
  check('with the module back, the same password opens it and the credential is intact', u.ok && (await get('SVC_ONE')).value === SECRET1);
  check('and the refusal no longer marks it unreadable', (await status()).unreadable === false);
  await lock();

  // ═══ 3. a new vault WITHOUT Argon2 ═════════════════════════════════════════════════════════════
  section('a new vault with Argon2 missing: the weaker fallback, said out loud');
  const home2 = newHome();
  argonBlocked = true;
  st = await status();
  check('before it exists: status says a new one would use scrypt and is weak', st.exists === false && st.kdf === 'scrypt' && st.weakKdf === true);
  resetCounts();
  u = await unlock();
  check('it opens, reports scrypt and weak', u.ok && u.fresh === true && u.kdf === 'scrypt' && u.weakKdf === true && counts().a === 0 && counts().s === 1);
  await set('SVC_ONE', SECRET1);
  check('the file names scrypt', header(home2).kdf === 'scrypt');
  st = await status();
  check('unlocked status is weak too', st.unlocked === true && st.kdf === 'scrypt' && st.weakKdf === true);
  await lock();
  argonBlocked = false;
  st = await status();
  check('with Argon2 available again the vault STAYS on scrypt (no silent upgrade) and stays flagged', st.kdf === 'scrypt' && st.weakKdf === true);
  resetCounts();
  u = await unlock();
  check('and it opens under scrypt, because that is what sealed it', u.ok && u.kdf === 'scrypt' && (await get('SVC_ONE')).value === SECRET1 && counts().s === 1 && counts().a === 0, JSON.stringify(counts()));
  await set('SVC_TWO', SECRET2);
  check('writing again keeps the record (still scrypt)', header(home2).kdf === 'scrypt');
  await lock();
  u = await unlock();
  check('both credentials survive a lock and unlock', u.ok && (await get('SVC_ONE')).value === SECRET1 && (await get('SVC_TWO')).value === SECRET2);
  await lock();

  // ═══ 4. old vaults: no record ══════════════════════════════════════════════════════════════════
  section('old vaults (no record) still open, whichever way they were sealed');
  rewrite(home2, (h) => { delete h.kdf; });
  st = await status();
  check('a vault with no record is reported as unknown, not guessed', st.kdf === null && st.weakKdf === false && st.exists === true);
  resetCounts();
  u = await unlock();
  check('an old scrypt vault opens while Argon2 is present (second candidate)', u.ok && u.kdf === 'scrypt' && (await get('SVC_ONE')).value === SECRET1, JSON.stringify(u));
  check('it cost two derivations: Argon2 tried first, then scrypt', counts().a === 1 && counts().s === 1, JSON.stringify(counts()));
  await set('SVC_THREE', SECRET3);
  check('the next write adds the record, and it says the TRUE derivation', header(home2).kdf === 'scrypt');
  await lock();
  rewrite(home2, (h) => { delete h.kdf; });
  const beforeLegacy = digest(home2);
  resetCounts();
  const wrongLegacy = await unlock(OTHER);
  check('a wrong password on an old vault fails after BOTH derivations', wrongLegacy.ok === false && /wrong master password|tampered/.test(wrongLegacy.error) && counts().a === 1 && counts().s === 1, JSON.stringify([wrongLegacy.error, counts()]));
  check('and leaves the file untouched and the vault locked', digest(home2) === beforeLegacy && (await status()).unlocked === false);

  const home3 = newHome();
  await lock();
  await unlock();
  await set('SVC_ONE', SECRET1);
  await lock();
  rewrite(home3, (h) => { delete h.kdf; });
  u = await unlock();
  check('an old Argon2 vault opens on the first candidate', u.ok && u.kdf === 'argon2id' && (await get('SVC_ONE')).value === SECRET1);
  await set('SVC_TWO', SECRET2);
  check('and records Argon2id on its next write', header(home3).kdf === 'argon2id');
  await lock();
  rewrite(home3, (h) => { delete h.kdf; });
  argonBlocked = true;
  const legacyNoModule = await unlock();
  check('an old Argon2 vault with the module missing fails safely as a failed open (a legacy file cannot say more)', legacyNoModule.ok === false && (await status()).unlocked === false);
  argonBlocked = false;
  check('and opens again when the module is back', (await unlock()).ok === true);
  await lock();

  // ═══ 4b. a vault built independently of the module, as the OLD code built it ═══════════════════
  section('a vault sealed by an independent implementation of the old format still opens');
  // The suite re-implements the old sealing from scratch (salt file, KDF parameters, AES-256-GCM, HMAC-SHA512,
  // verifier) so a change to the module's parameters cannot be hidden by the module agreeing with itself.
  async function sealOld(home, kdf, pw, service, value) {
    const dir = path.join(home, '.rama-agi');
    fs.mkdirSync(dir, { recursive: true });
    const salt = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(path.join(dir, 'rama_vault.salt'), salt);
    const key = kdf === 'argon2id'
      ? await realHash.call(argon2, pw, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 2, hashLength: 32, salt: Buffer.from(salt, 'hex'), raw: true })
      : await new Promise((res, rej) => realScrypt.call(crypto, pw, salt, 32, { N: 16384, r: 8, p: 1 }, (e, k) => (e ? rej(e) : res(k))));
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ct = Buffer.concat([cipher.update(JSON.stringify({ version: 1, data: { [service]: { value, meta: {}, addedAt: 1 } }, ts: 1 }), 'utf8'), cipher.final()]);
    const enc = Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64');
    const hmac = crypto.createHmac('sha512', key).update(enc).digest('hex');
    const verifier = crypto.createHmac('sha512', key).update('rama-vault-verifier-v1').digest('hex');
    fs.writeFileSync(path.join(dir, 'rama_vault.enc'), JSON.stringify({ version: 1, enc, hmac, verifier }));
  }
  for (const kdf of ['scrypt', 'argon2id']) {
    const h = newHome();
    await lock();
    await sealOld(h, kdf, PW, 'OLD_SVC', SECRET1);
    const o = await unlock();
    check(`an old ${kdf} vault (no record) opens, and says which it was`, o.ok && o.kdf === kdf && (await get('OLD_SVC')).value === SECRET1, JSON.stringify(o));
    await lock();
  }

  // ═══ 5. a hostile or unknown header ════════════════════════════════════════════════════════════
  section('a header this version does not understand');
  const home4 = newHome();
  await unlock();
  await set('SVC_ONE', SECRET1);
  await lock();
  rewrite(home4, (h) => { h.kdf = 'md5'; });
  const before4 = digest(home4);
  resetCounts();
  const unk = await unlock();
  check('an unknown derivation is refused by name and derives nothing', unk.ok === false && /does not know/.test(unk.error) && /md5/.test(unk.error) && counts().a === 0 && counts().s === 0);
  check('and the file is untouched', digest(home4) === before4);
  rewrite(home4, (h) => { h.kdf = '\u001b[31m' + 'x'.repeat(300); });
  const hostile = await unlock();
  check('a hostile value is never echoed back', hostile.ok === false && !hostile.error.includes('\u001b') && !hostile.error.includes('xxxxx'));
  rewrite(home4, (h) => { h.kdf = 42; });
  const numeric = await unlock();
  check('a non-text value is treated as no record (legacy), not as a crash', typeof numeric.ok === 'boolean');
  rewrite(home4, (h) => { h.kdf = 'argon2id'; });
  check('restoring the real value opens it', (await unlock()).ok === true && (await get('SVC_ONE')).value === SECRET1);
  await lock();

  // ═══ 6. the gate and the source ════════════════════════════════════════════════════════════════
  section('the gate and where it is wired');
  check('a tier-3 caller still cannot unlock', (await call('vault:unlock', { user: { id: 'o', tier: 3 }, password: PW })).ok === false);
  const src = fs.readFileSync(path.join(ROOT, 'electron/ipc/credentialVault.cjs'), 'utf8');
  check('there is no silent try/catch fallback between derivations any more', !/async function deriveKey\(/.test(src) && !/Fallback to scrypt if argon2 native not built/.test(src));
  check('the derivation is chosen by planKdf, from the file', /const plan = planKdf\(\)/.test(src) && /for \(const kdf of plan\.candidates\)/.test(src));
  check('scrypt keeps the parameters every existing vault was sealed with', /N: 16384, r: 8, p: 1/.test(src) && /crypto\.scrypt\(password, salt, 32,/.test(src));
  check('argon2 keeps its parameters', /ARGON_MEMORY\s*=\s*65536/.test(src) && /ARGON_ITER\s*=\s*3/.test(src) && /ARGON_THREADS\s*=\s*2/.test(src));
  check('saveVault writes the record', /\.\.\.\(vaultKdf \? \{ kdf: vaultKdf \} : \{\}\)/.test(src));
  const models = fs.readFileSync(path.join(ROOT, 'src/pages/Models/Models.jsx'), 'utf8');
  check('Models reads weakKdf from the vault status and shows a warning', /weakKdf: !!vRes\.weakKdf/.test(models) && /\{vaultState\.weakKdf && \(/.test(models) && /weaker key derivation \(scrypt\)/.test(models));
  const envEx = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8');
  check('the unused secret is gone from .env.example, and the file says no secret belongs there', !/HMAC_SECRET/.test(envEx) && /No secret belongs in this file/.test(envEx));
  check('nothing in the app reads HMAC_SECRET', (() => {
    const hits = [];
    const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (e.name === 'node_modules' || e.name === '.git') continue; const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(cjs|js|jsx|mjs)$/.test(e.name) && !/verify/.test(e.name) && /HMAC_SECRET/.test(fs.readFileSync(p, 'utf8'))) hits.push(p); } };
    for (const d of ['electron', 'server', 'src', 'shared']) walk(path.join(ROOT, d));
    return hits.length === 0;
  })());
  check('no console.log', !/console\.log/.test(src));

  for (const d of sandboxes) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* temp cleanup is best effort */ } }
  finished = true;
  console.warn(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((err) => { console.warn('  FAIL  suite crashed: ' + err.stack); finished = true; process.exit(1); });
