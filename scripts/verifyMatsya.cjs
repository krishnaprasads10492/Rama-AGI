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

// ─── Stage 2: the actor, proven by a real round trip (spec Section 193) ─────────────────────────
section('a snapshot restores, byte for byte, and refuses what it must');
{
  const crypto = require('crypto');
  const S = require('../electron/lib/matsyaSnapshot.cjs');

  // REAL AES-256-GCM, not a fake cipher. A reversible stand-in would prove the plumbing and say
  // nothing about whether the stored bytes are actually unreadable, which is the claim that
  // matters for an egress.
  const KEY = crypto.scryptSync('a passphrase master would type', 'matsya-suite-salt', 32);
  const encrypt = (buf) => {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
    const body = Buffer.concat([c.update(buf), c.final()]);
    return Buffer.concat([iv, c.getAuthTag(), body]);
  };
  const decrypt = (buf) => {
    const d = crypto.createDecipheriv('aes-256-gcm', KEY, buf.subarray(0, 12));
    d.setAuthTag(buf.subarray(12, 28));
    return Buffer.concat([d.update(buf.subarray(28)), d.final()]);
  };
  const digest = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

  // In-memory source and destination: deterministic, and it cannot leave litter behind.
  const SECRET = 'master private notes — the sort of thing a backup must never expose';
  const TOKEN = 'GITHUB_TOKEN=should_never_leave';
  const source = new Map([
    ['data/knowledge/notes.md', Buffer.from(SECRET)],
    ['data/system/store.enc', Buffer.from([1, 2, 3, 4, 5])],
    ['.env', Buffer.from(TOKEN)],
  ]);
  const store = new Map();
  const read = (p) => {
    if (source.has(p)) return source.get(p);
    if (store.has(p)) return store.get(p);
    throw new Error(`no such file: ${p}`);
  };
  const write = (p, b) => { store.set(p, Buffer.from(b)); };

  const res = S.snapshot({ files: [...source.keys()], read, write, encrypt, digest, out: 'dst' });
  check('the snapshot succeeds', res.ok === true, res.error);
  check('it stores the two permitted files and no more', res.written === 2, String(res.written));
  check('and refuses the .env', res.refused.length === 1 && res.refused[0].path === '.env');

  // THE EGRESS ASSERTION: nothing readable may appear anywhere in the destination.
  const all = Buffer.concat([...store.values()]);
  check('no plaintext from the source appears anywhere in the destination',
    !all.includes(SECRET) && !all.includes(TOKEN));
  check('and the refused file is not stored under any name',
    ![...store.keys()].some((k) => /\.env/.test(k)));

  // BLOB NAMES ARE DIGESTS. A path used as a filename would leak the tree in cleartext.
  const blobs = [...store.keys()].filter((k) => k.startsWith('dst/blobs/'));
  check('every blob is named by its digest, so no path leaks into a filename',
    blobs.length === 2 && blobs.every((b) => /^dst\/blobs\/[0-9a-f]{64}\.blob$/.test(b)), blobs.join(','));
  check('no destination filename contains a source path',
    ![...store.keys()].some((k) => /knowledge|notes|store\.enc/.test(k)), [...store.keys()].join(','));

  // The marker is the only readable thing, and only identifies the format.
  const marker = JSON.parse(store.get('dst/SNAPSHOT.json').toString('utf8'));
  check('the marker identifies the snapshot without the key',
    marker.format === S.FORMAT && marker.count === 2 && marker.encrypted === true);
  check('and carries no paths, no hostname and no app version',
    !/path|host|version"\s*:\s*"/i.test(JSON.stringify(marker).replace(/"format"/, '')),
    JSON.stringify(marker));
  check('the index itself is encrypted, since a list of paths is the same inventory',
    !store.get('dst/MANIFEST.enc').includes('knowledge'));

  // Read the index back — which requires the key, and that is the point.
  const idx = S.readManifest({ read, decrypt, from: 'dst' });
  check('the manifest reads back with the key', idx.ok === true && idx.manifest.count === 2, idx.error);
  check('and without the key it fails rather than returning something partial',
    S.readManifest({ read, decrypt: () => { throw new Error('bad key'); }, from: 'dst' }).ok === false);

  // THE ONLY CHECK THAT ANSWERS "WOULD THIS BRING MASTER'S DATA BACK".
  const back = new Map();
  const r = S.restore({
    manifest: idx.manifest, read, write: (p, b) => back.set(p, Buffer.from(b)),
    decrypt, digest, from: 'dst', into: 'out',
  });
  check('the restore succeeds', r.ok === true && r.restored === 2, r.error);
  check('an encrypted file comes back byte-identical',
    back.get('out/data/knowledge/notes.md').toString('utf8') === SECRET);
  check('a ciphertext passthrough comes back byte-identical',
    Buffer.compare(back.get('out/data/system/store.enc'), Buffer.from([1, 2, 3, 4, 5])) === 0);
  check('and the refused file is absent from the restore, because it never left',
    ![...back.keys()].some((k) => /\.env/.test(k)));

  // TAMPER. A blob altered at the destination must be refused BEFORE it is written.
  const victim = blobs[0];
  const bad = Buffer.from(store.get(victim)); bad[bad.length - 1] ^= 0xff;
  const tampered = new Map(store); tampered.set(victim, bad);
  const back2 = new Map();
  const r2 = S.restore({
    manifest: idx.manifest,
    read: (p) => { if (tampered.has(p)) return tampered.get(p); throw new Error('missing'); },
    write: (p, b) => back2.set(p, Buffer.from(b)),
    decrypt, digest, from: 'dst', into: 'out',
  });
  check('a tampered blob is detected', r2.ok === false && r2.altered.length === 1);
  check('and the tampered file is NOT written into the restore target',
    ![...back2.keys()].some((k) => k.endsWith(r2.altered[0].path)), [...back2.keys()].join(','));
  check('while its untampered sibling is still restored', r2.restored === 1);
  const r3 = S.restore({
    manifest: idx.manifest, read: () => { throw new Error('gone'); },
    write: () => {}, decrypt, digest, from: 'dst', into: 'out',
  });
  check('a missing blob is reported as missing, not altered',
    r3.missing.length === 2 && r3.altered.length === 0);
  // THE MESSAGE MUST SAY IT TOO, not just the arrays. A mutation that collapsed the restore's
  // wording to "restore incomplete" survived a check that only read the arrays — and the message
  // is what a reader sees, so an incomplete restore and a tampered one would look identical to
  // the only audience that matters.
  check('and the restore MESSAGE keeps the two apart, not only the arrays',
    /2 missing, 0 altered/.test(r3.error || '') && /0 missing, 1 altered/.test(r2.error || ''),
    `${r3.error} | ${r2.error}`);

  // NO CIPHER, NO SNAPSHOT. The one failure mode this module must make impossible is writing in
  // the clear because a key was not supplied.
  for (const missing of ['read', 'write', 'encrypt', 'digest']) {
    const args = { files: ['data/x.json'], read, write, encrypt, digest, out: 'dst' };
    delete args[missing];
    const r4 = S.snapshot(args);
    check(`a snapshot without ${missing} refuses rather than defaulting`,
      r4.ok === false && new RegExp(missing).test(r4.error || ''), r4.error);
  }
  check('a restore with no manifest refuses',
    S.restore({ read, write, decrypt, digest }).ok === false);

  // An unreadable source file must be carried as a failure, not silently omitted from a "success".
  const partial = S.snapshot({
    files: ['data/knowledge/notes.md', 'data/gone.json'],
    read: (p) => { if (p === 'data/gone.json') throw new Error('EACCES'); return read(p); },
    write, encrypt, digest, out: 'dst2',
  });
  check('an unreadable file fails the snapshot rather than being quietly skipped',
    partial.ok === false && partial.failures.length === 1 && /EACCES/.test(partial.failures[0].error));

  // It must not be able to delete anything.
  const code = fs.readFileSync(path.join(ROOT, 'electron', 'lib', 'matsyaSnapshot.cjs'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ').split('\n').map((l) => l.replace(/(^|\s)\/\/.*/, '')).join('\n');
  check('the actor can delete nothing — no prune, no rotate, no unlink',
    !/unlink|rmSync|rmdir|prune|rotate|truncate/i.test(code));
  check('and it reaches no network', !/https?:\/\/|net\.|fetch\(/.test(code));
  check('it takes no default key, destination or data directory',
    !/getDataDir|process\.env|os\.homedir/.test(code));
}

console.log(`\n${'='.repeat(62)}`);
console.log(`  ${pass} passed, ${fail} failed`);
console.log('='.repeat(62));
process.exit(fail === 0 ? 0 : 1);
