'use strict';

/**
 * verifyMatsya.cjs — what may leave the machine, and what must not (spec Section 192)
 *
 * THIS SUITE GUARDS AN EGRESS, which makes it different from the others. A backup takes the most
 * sensitive data in the system and writes it somewhere less protected, so the expensive mistake is
 * not a crash — it is a file that should never have been copied, and a leak cannot be recalled.
 *
 * So the rules are driven with hostile paths: a `.env` three directories down, a private key named
 * to look like data, a Windows separator, a token file sitting inside `data/` where the catch-all
 * would otherwise claim it. The ORDER of the rule table is itself asserted, because a refusal rule
 * that stops winning is indistinguishable from a rule that was deleted.
 *
 * Run: node scripts/verifyMatsya.cjs   (or npm run verify:matsya)
 */

const fs = require('fs');
const path = require('path');
const M = require('../electron/lib/matsya.cjs');

const ROOT = path.join(__dirname, '..');
let pass = 0;
let fail = 0;
const check = (label, ok, detail) => {
  if (ok) { pass += 1; console.log(`  PASS  ${label}`); }
  else { fail += 1; console.log(`  FAIL  ${label}${detail ? ` - ${detail}` : ''}`); }
};
const section = (t) => console.log(`\n--- ${t} ---`);
const cls = (p) => M.classify(p).cls;

// ─── Refusal wins, wherever the file sits ────────────────────────────────────────────────────────
section('a file that must never leave is refused wherever it is');
{
  const mustNever = [
    '.env', 'data/.env', 'a/b/c/.env', '.env.local', 'data/system/.env.production',
    'data\\system\\.env', 'id_rsa', 'data/keys/id_ed25519', 'certs/server.pem',
    'data/x.pfx', 'data/y.p12', 'secrets/app.key',
    'data/github_token.json', 'data/system/credential-cache.json',
    'data/my_password_hint.txt', 'data/logs/crash-1234.dmp', 'dumps/crash.mdmp',
  ];
  for (const p of mustNever) check(`refused: ${p}`, cls(p) === 'never', cls(p));

  // ORDER IS LOAD-BEARING. `data/` has a catch-all that classifies everything inside it as
  // `encrypt`; a credential dropped in there must still be refused, which only holds while the
  // refusal rules are checked first.
  check('a token-named file INSIDE data/ is still refused, so rule order holds',
    cls('data/instances/access_token.json') === 'never');
  check('and a dump inside data/logs is refused, not encrypted',
    cls('data/logs/crash.dmp') === 'never');
  check('the refusal carries a reason a reader can act on',
    /credential|private key|memory image/i.test(M.classify('.env').why), M.classify('.env').why);
}

// ─── Already-encrypted files travel as they are ─────────────────────────────────────────────────
section('ciphertext is copied, not re-encrypted');
{
  for (const p of ['data/system/store.enc', 'rama_vault.enc', 'data/instances/x.enc']) {
    check(`ciphertext: ${p}`, cls(p) === 'ciphertext', cls(p));
  }
  check('and the reason says why re-encryption is unnecessary',
    /encrypted/i.test(M.classify('data/system/store.enc').why));
}

// ─── Master's own record is kept, encrypted ─────────────────────────────────────────────────────
section('master\u2019s record is kept, and only in ciphertext');
{
  for (const p of [
    'data/knowledge/notes.md', 'data/instances/this.json', 'data/logs/build-1.log',
    'data/system/readiness.json', 'shared/capabilities.json', 'shared/loyalty-tripwire.json',
    // THE ONE RUNNING IT FOUND: refused for want of a rule, and it is exactly what a backup is for.
    'data/field-evidence.json',
  ]) {
    check(`encrypt: ${p}`, cls(p) === 'encrypt', cls(p));
  }
  check('nothing in the encrypt class is ever described as copy-as-is',
    M.plan(['data/knowledge/a.md']).copy.length === 0);
}

// ─── An unclassified file is refused, not guessed at ────────────────────────────────────────────
section('the default is refusal');
{
  // Outside `data/` the strict default stands: the source tree and shared config are in git and
  // are not master's record.
  for (const p of ['shared/resourceCatalog.json', 'electron/main.cjs', 'package.json', 'README.md']) {
    check(`unclassified outside data/ is refused: ${p}`, cls(p) === 'never', cls(p));
  }
  const u = M.classify('some/unknown/thing.bin');
  check('and the reason says a rule must be added rather than implying the file is dangerous',
    /no rule covers this path/.test(u.why) && /add a rule/.test(u.why), u.why);
  check('an unmatched decision is marked unmatched, so the count is honest',
    M.classify('some/unknown/thing.bin').matched === false
    && M.classify('.env').matched === true);
  check('an empty path is refused rather than throwing', cls('') === 'never' && cls(null) === 'never');
}

// ─── The plan adds up ───────────────────────────────────────────────────────────────────────────
section('the plan accounts for every file it was given');
{
  const files = ['data/system/store.enc', 'data/knowledge/a.md', '.env', 'weird.bin', 'data/x.json'];
  const p = M.plan(files);
  check('every file lands in exactly one class',
    p.totals.ciphertext + p.totals.encrypt + p.totals.never === p.totals.considered
    && p.totals.considered === files.length,
    JSON.stringify(p.totals));
  check('the classes hold what their counts say',
    p.copy.length === p.totals.ciphertext && p.encrypt.length === p.totals.encrypt
    && p.refuse.length === p.totals.never);
  check('unmatched files are counted separately from deliberate refusals',
    p.totals.unmatched === 1 && p.totals.never === 2, JSON.stringify(p.totals));
  // NO VERDICT FIELD. A plan that said `ok: true` would invite a caller to send without reading
  // what was refused.
  check('the plan offers no ok/clean verdict for a caller to lean on',
    !('ok' in p) && !('clean' in p) && !('safe' in p), Object.keys(p).join(','));
  check('garbage input produces an empty plan rather than a throw', (() => {
    for (const bad of [null, undefined, 'str', 42, {}, [null, 7, '', {}]]) {
      const r = M.plan(bad);
      if (!r || !r.totals) return false;
    }
    return true;
  })());
  check('the printed lines name every refusal, not just a count', (() => {
    const t = M.lines(p).join('\n');
    return /REFUSED \.env/.test(t) && /REFUSED weird\.bin/.test(t);
  })(), M.lines(p).join(' | '));
}

// ─── The manifest is what makes a restore checkable ─────────────────────────────────────────────
section('the manifest');
{
  const m = M.manifest([
    { path: 'b.enc', cls: 'ciphertext', bytes: 10, digest: 'bb' },
    { path: 'a.md', cls: 'encrypt', bytes: 20, digest: 'aa' },
    { path: 'no-digest.md', cls: 'encrypt', bytes: 5 },
    null,
  ], { at: '2026-11-06T00:00:00Z' });
  check('rows without a digest are dropped, since they cannot be verified later', m.count === 2);
  check('entries are sorted, so two manifests of one tree compare equal',
    m.entries.map((e) => e.path).join(',') === 'a.md,b.enc');
  check('both kept classes are marked encrypted', m.entries.every((e) => e.encrypted === true));
  check('an unknown class is recorded as never rather than trusted',
    M.manifest([{ path: 'x', cls: 'invented', digest: 'd' }]).entries[0].cls === 'never');
  check('a missing size is null, not zero',
    M.manifest([{ path: 'x', cls: 'encrypt', digest: 'd' }]).entries[0].bytes === null);
  check('it carries a version, so a later format change is detectable', m.version === 1);
  check('and the time it was taken', m.at === '2026-11-06T00:00:00Z');
  check('no entries yields an empty manifest rather than a throw',
    M.manifest().count === 0 && M.manifest(null).count === 0);
}

// ─── Verification distinguishes incomplete from tampered ────────────────────────────────────────
section('a missing file and an altered file are different events');
{
  const expected = M.manifest([
    { path: 'a', cls: 'encrypt', digest: 'aa' },
    { path: 'b', cls: 'encrypt', digest: 'bb' },
  ]);
  const good = M.verify(expected, [{ path: 'a', digest: 'aa' }, { path: 'b', digest: 'bb' }]);
  check('a whole restore verifies', good.ok === true && good.matched === 2 && good.reason === null);

  const gone = M.verify(expected, [{ path: 'a', digest: 'aa' }]);
  check('a missing file is reported as missing', gone.ok === false && gone.missing.join() === 'b');
  check('and not as altered', gone.altered.length === 0);

  const changed = M.verify(expected, [{ path: 'a', digest: 'aa' }, { path: 'b', digest: 'XX' }]);
  check('a changed file is reported as ALTERED, which is the tamper signal',
    changed.ok === false && changed.altered.length === 1 && changed.altered[0].path === 'b');
  check('and it carries both digests, so the difference is checkable',
    changed.altered[0].expected === 'bb' && changed.altered[0].found === 'XX');
  check('missing and altered are never collapsed into one number',
    /1 missing, 0 altered/.test(gone.reason) && /0 missing, 1 altered/.test(changed.reason),
    `${gone.reason} | ${changed.reason}`);

  const extra = M.verify(expected, [{ path: 'a', digest: 'aa' }, { path: 'b', digest: 'bb' }, { path: 'c', digest: 'cc' }]);
  check('an extra file at the destination is reported but not fatal — older snapshots are normal',
    extra.ok === true && extra.extra.join() === 'c');

  check('no manifest means NOT verified, never verified-by-default',
    M.verify(null, []).ok === false && /no manifest was supplied/.test(M.verify(null, []).reason));
  check('and an empty actual list against a real manifest fails rather than passing',
    M.verify(expected, []).ok === false && M.verify(expected, null).ok === false);
}

// ─── The module itself ─────────────────────────────────────────────────────────────────────────
section('the module stays a judgement, not an actor');
{
  const src = fs.readFileSync(path.join(ROOT, 'electron', 'lib', 'matsya.cjs'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').split('\n')
    .map((l) => l.replace(/(^|\s)\/\/.*/, '')).join('\n');

  // PURE, for the same reason `vulnerabilityTriage` and `threatPosture` are: the decision that can
  // be expensively wrong must be testable without a disk or a network.
  check('it writes nothing', !/writeFileSync|mkdirSync|rmSync|unlinkSync|createWriteStream/.test(code));
  check('it reads nothing', !/readFileSync|readdirSync|createReadStream/.test(code));
  check('it reaches no network', !/https?:\/\/|net\.|http\.cjs|fetch\(/.test(code));
  check('it spawns nothing', !/exec|spawn/.test(code));
  check('it does its own crypto nowhere — the digest is supplied by the caller',
    !/createHash|createCipher|randomBytes/.test(code));
  check('it requires only path', (code.match(/require\('([^']+)'\)/g) || []).join() === "require('path')",
    (code.match(/require\('([^']+)'\)/g) || []).join());

  check('the rule table is declared data, so a new file kind is a new row',
    /const RULES = Object\.freeze\(\[/.test(code));
  check('every rule carries a class and a reason',
    M.RULES.every((r) => M.CLASSES.includes(r.cls) && typeof r.why === 'string' && r.why.length > 20));
  check('every rule has a usable test', M.RULES.every((r) => r.test instanceof RegExp));
  // THE ORDERING ASSERTION: every refusal rule must precede the data/ catch-all, or a credential
  // inside data/ would be classified as merely needing encryption.
  check('all refusal rules come before the data/ catch-all', (() => {
    const lastNever = M.RULES.map((r, i) => [r.cls, i]).filter(([c]) => c === 'never').pop();
    const catchAll = M.RULES.findIndex((r) => r.cls === 'encrypt' && r.test.test('data/anything.xyz'));
    return lastNever && catchAll > lastNever[1];
  })());
  check('and it does not decide where the copy goes, which is master\u2019s choice',
    !/destination|upload|remote|s3|azure|dropbox/i.test(code));
}

console.log(`\n${'='.repeat(62)}`);
console.log(`  ${pass} passed, ${fail} failed`);
console.log('='.repeat(62));
process.exit(fail === 0 ? 0 : 1);
