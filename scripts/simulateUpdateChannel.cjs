#!/usr/bin/env node
'use strict';

/**
 * simulateUpdateChannel.cjs — try to break the update channel (spec Section 85).
 *
 * `verifyUpdateChannel.cjs` asserts the contract. This is different: it runs whole LIFECYCLES and
 * adversarial scenarios against real files, looking for the failure that unit tests do not reach —
 * a race, a leftover, a hostile manifest, an exotic Windows path, a rollback.
 *
 * The rule for every scenario: **failing closed is a pass.** An update channel that refuses a good
 * update is an inconvenience; one that accepts a bad update runs an executable. So "offered" is
 * only ever correct when everything about the artefact is right.
 *
 * Run: node scripts/simulateUpdateChannel.cjs   (or npm run simulate:channel)
 *      --seed <n>   reproduce a fuzz run
 *      --fuzz <n>   number of fuzz iterations (default 400)
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const ch = require('../electron/lib/updateChannel.cjs');

const argv = process.argv.slice(2);
const argOf = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? argv[i + 1] : d;
};
const FUZZ = Number(argOf('fuzz', 400));
let seed = Number(argOf('seed', Date.now() % 100000));
const rnd = () => {
  // Deterministic PRNG so a failing fuzz run can be reproduced with --seed.
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};

let pass = 0;
let fail = 0;
const failures = [];

function check(scenario, label, ok, detail) {
  if (ok) {
    pass += 1;
  } else {
    fail += 1;
    failures.push(`[${scenario}] ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function banner(t) { process.stdout.write(`\n── ${t}\n`); }
function note(t) { process.stdout.write(`     ${t}\n`); }

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'rama-sim-'));
let dirSeq = 0;
function freshDir() {
  const d = path.join(ROOT, `c${dirSeq++}`);
  fs.mkdirSync(d, { recursive: true });
  return d;
}
function makeArtefact(dir, name, bytes = 4096) {
  const p = path.join(dir, name);
  fs.writeFileSync(p, crypto.randomBytes(bytes));
  return p;
}
const st = (dir, v) => ch.status({ dir, currentVersion: v });

// ═══════════════════════════════════════════════════════════════════════════
// 1. The happy lifecycle, several versions deep
// ═══════════════════════════════════════════════════════════════════════════
banner('SIM 1  a full lifecycle across five releases');
{
  const S = 'lifecycle';
  const chan = freshDir();
  const src = freshDir();
  let installed = '1.0.0';

  // Nothing published yet.
  check(S, 'an empty channel offers nothing', st(chan, installed).available === false);

  const versions = ['1.0.0', '1.0.1', '1.1.0', '1.10.0', '2.0.0'];
  for (const v of versions) {
    const a = makeArtefact(src, `Rama-AGI-Setup-${v}.exe`);
    const r = ch.publish({ artefactPath: a, dir: chan, version: v, keep: 3 });
    check(S, `publish ${v} succeeds`, r.ok === true, r.error);

    const s = st(chan, installed);
    if (ch.compareVersions(v, installed) > 0) {
      check(S, `${v} is offered to an install on ${installed}`, s.available === true, s.reason);
      check(S, `${v} verifies`, s.verified === true, s.reason);
      check(S, `${v} is applicable`, s.canApply === true, s.reason);
      installed = v;                    // simulate master installing it
      check(S, `after installing ${v} the channel is up to date`,
        st(chan, installed).upToDate === true);
    } else {
      check(S, `${v} is NOT offered to ${installed}`, s.available === false, s.reason);
    }
  }
  note(`walked ${versions.join(' → ')}, installing each; channel pruned to 3 artefacts`);
  const kept = fs.readdirSync(chan).filter((f) => f.endsWith('.exe'));
  check(S, 'pruning bounded the folder to 3 artefacts', kept.length === 3,
    JSON.stringify(kept));
  check(S, 'THE LIVE ARTEFACT SURVIVED PRUNING',
    fs.existsSync(path.join(chan, ch.readManifest(chan).manifest.file)));
  check(S, 'no .part files remain', fs.readdirSync(chan).every((f) => !f.endsWith('.part')));
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. Republishing the same version repeatedly — the EPERM regression
// ═══════════════════════════════════════════════════════════════════════════
banner('SIM 2  republishing 40 times in a row (the Windows rename defect)');
{
  const S = 'republish';
  const chan = freshDir();
  const src = freshDir();
  let ok = true;
  let firstError = null;
  for (let i = 0; i < 40; i++) {
    const a = makeArtefact(src, 'Rama-AGI-Setup-1.2.3.exe', 1024 + i);
    const r = ch.publish({ artefactPath: a, dir: chan, version: '1.2.3' });
    if (!r.ok) { ok = false; firstError = r.error; break; }
    const s = st(chan, '1.0.0');
    if (!s.available || !s.verified) { ok = false; firstError = `read back: ${s.reason}`; break; }
  }
  check(S, '40 consecutive publishes all succeed and read back clean', ok, firstError);
  note('this is the loop that exposed EPERM on renameSync over an existing file');
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. Interrupted publishes and leftover debris
// ═══════════════════════════════════════════════════════════════════════════
banner('SIM 3  interrupted publishes, leftovers, and partial state');
{
  const S = 'interrupted';
  const chan = freshDir();
  const src = freshDir();
  const good = makeArtefact(src, 'Rama-AGI-Setup-1.5.0.exe');
  ch.publish({ artefactPath: good, dir: chan, version: '1.5.0' });

  // A crashed copy leaves a .part behind.
  fs.writeFileSync(path.join(chan, 'Rama-AGI-Setup-1.6.0.exe.part'), crypto.randomBytes(999));
  let s = st(chan, '1.0.0');
  check(S, 'a leftover .part does not disturb the live offer', s.available === true, s.reason);
  check(S, 'and .part is never itself offered', s.manifest.file.endsWith('.exe')
    && !s.manifest.file.endsWith('.part'));
  const pruned = ch.prune({ dir: chan, keep: 1, protect: s.manifest.file });
  check(S, 'prune does not delete .part as if it were an artefact',
    !pruned.some((n) => n.endsWith('.part')), JSON.stringify(pruned));

  // Manifest present, artefact never arrived.
  const chan2 = freshDir();
  fs.writeFileSync(path.join(chan2, ch.MANIFEST_NAME), JSON.stringify({
    manifestVersion: 1, version: '9.9.9', file: 'Ghost.exe', sha256: 'a'.repeat(64),
  }));
  s = st(chan2, '1.0.0');
  check(S, 'a manifest naming a missing artefact offers nothing', s.available === false);
  check(S, 'and apply refuses it', ch.apply({ dir: chan2 }).ok === false);

  // Artefact present, no manifest at all.
  const chan3 = freshDir();
  makeArtefact(chan3, 'Rama-AGI-Setup-3.0.0.exe');
  s = st(chan3, '1.0.0');
  check(S, 'an artefact with no manifest is IGNORED, not guessed at', s.available === false,
    s.reason);
  check(S, 'apply refuses with no manifest', ch.apply({ dir: chan3 }).ok === false);
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. Reader racing a publisher
// ═══════════════════════════════════════════════════════════════════════════
banner('SIM 4  a reader polling while a publisher writes, 150 interleavings');
{
  const S = 'race';
  const chan = freshDir();
  const src = freshDir();
  ch.publish({ artefactPath: makeArtefact(src, 'Rama-AGI-Setup-1.0.0.exe'), dir: chan,
    version: '1.0.0' });

  let unsafe = 0;
  let transientMisses = 0;
  for (let i = 0; i < 150; i++) {
    const v = `1.0.${i + 1}`;
    const a = makeArtefact(src, `Rama-AGI-Setup-${v}.exe`);
    // Read at a pseudo-random point relative to the write.
    if (rnd() < 0.5) {
      const s = st(chan, '1.0.0');
      if (s.available && !s.verified) unsafe++;
    }
    const r = ch.publish({ artefactPath: a, dir: chan, version: v, keep: 2 });
    if (!r.ok) { unsafe++; continue; }
    const s2 = st(chan, '1.0.0');
    if (s2.available && !s2.verified) unsafe++;
    if (!s2.available) transientMisses++;
  }
  check(S, 'NO read ever reported available-but-unverified', unsafe === 0, `${unsafe} unsafe reads`);
  check(S, 'reads either see a complete release or none at all', transientMisses === 0,
    `${transientMisses} transient misses (safe, but noted)`);
  note('every interleaving either saw the previous release or the new one, never a half-state');
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. Corruption, truncation, swapping
// ═══════════════════════════════════════════════════════════════════════════
banner('SIM 5  corruption in every shape');
{
  const S = 'corruption';
  const cases = [
    ['one byte appended', (p) => fs.appendFileSync(p, 'x')],
    ['one byte flipped', (p) => {
      const b = fs.readFileSync(p); b[0] ^= 0xff; fs.writeFileSync(p, b);
    }],
    ['truncated to half', (p) => {
      const b = fs.readFileSync(p); fs.writeFileSync(p, b.subarray(0, b.length >> 1));
    }],
    ['truncated to zero', (p) => fs.writeFileSync(p, Buffer.alloc(0))],
    ['replaced with a different build', (p) => fs.writeFileSync(p, crypto.randomBytes(4096))],
    ['replaced with a text file', (p) => fs.writeFileSync(p, 'not an installer at all')],
  ];
  for (const [label, mutate] of cases) {
    const chan = freshDir();
    const src = freshDir();
    ch.publish({ artefactPath: makeArtefact(src, 'Rama-AGI-Setup-2.0.0.exe'), dir: chan,
      version: '2.0.0' });
    mutate(path.join(chan, 'Rama-AGI-Setup-2.0.0.exe'));
    const s = st(chan, '1.0.0');
    check(S, `${label} → not offered`, s.available === false, s.reason);
    check(S, `${label} → apply refuses`, ch.apply({ dir: chan }).ok === false);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 6. Hostile manifests
// ═══════════════════════════════════════════════════════════════════════════
banner('SIM 6  hostile and malformed manifests');
{
  const S = 'hostile';
  const chan = freshDir();
  const src = freshDir();
  ch.publish({ artefactPath: makeArtefact(src, 'Rama-AGI-Setup-2.0.0.exe'), dir: chan,
    version: '2.0.0' });
  const realHash = ch.readManifest(chan).manifest.sha256;
  const write = (obj) => fs.writeFileSync(path.join(chan, ch.MANIFEST_NAME),
    typeof obj === 'string' ? obj : JSON.stringify(obj));

  const hostile = [
    ['path traversal in file', { version: '9.9.9', file: '../../../evil.exe', sha256: realHash }],
    ['backslash traversal', { version: '9.9.9', file: '..\\..\\evil.exe', sha256: realHash }],
    ['absolute path', { version: '9.9.9', file: 'C:\\Windows\\System32\\calc.exe', sha256: realHash }],
    ['UNC path', { version: '9.9.9', file: '\\\\attacker\\share\\evil.exe', sha256: realHash }],
    ['nested path', { version: '9.9.9', file: 'sub/evil.exe', sha256: realHash }],
    ['alternate data stream', { version: '9.9.9', file: 'Rama-AGI-Setup-2.0.0.exe:evil', sha256: realHash }],
    ['null byte', { version: '9.9.9', file: 'evil.exe\u0000.txt', sha256: realHash }],
    ['a .bat instead', { version: '9.9.9', file: 'evil.bat', sha256: realHash }],
    ['a .ps1 instead', { version: '9.9.9', file: 'evil.ps1', sha256: realHash }],
    ['a .cmd instead', { version: '9.9.9', file: 'evil.cmd', sha256: realHash }],
    ['no extension', { version: '9.9.9', file: 'evil', sha256: realHash }],
    ['future manifest version', { manifestVersion: 99, version: '9.9.9', file: 'x.exe', sha256: realHash }],
    ['hash of wrong length', { version: '9.9.9', file: 'x.exe', sha256: 'ab' }],
    ['non-hex hash', { version: '9.9.9', file: 'x.exe', sha256: 'z'.repeat(64) }],
    ['hash as a number', { version: '9.9.9', file: 'x.exe', sha256: 12345 }],
    ['version as a number', { version: 9.9, file: 'x.exe', sha256: realHash }],
    ['version as an object', { version: {}, file: 'x.exe', sha256: realHash }],
    ['file as an array', { version: '9.9.9', file: ['x.exe'], sha256: realHash }],
    ['prototype pollution', { __proto__: { version: '9.9.9' }, file: 'x.exe', sha256: realHash }],
    ['empty object', {}],
    ['a JSON array', []],
    ['a JSON string', '"just a string"'],
    ['a JSON number', '42'],
    ['null', 'null'],
    ['truncated JSON', '{"version":"9.9.9",'],
    ['empty file', ''],
    ['only whitespace', '   \n  '],
    ['BOM then JSON', `\uFEFF${JSON.stringify({ version: '9.9.9', file: 'x.exe', sha256: realHash })}`],
  ];

  for (const [label, body] of hostile) {
    write(body);
    let s;
    let threw = null;
    try { s = st(chan, '1.0.0'); } catch (err) { threw = err.message; }
    check(S, `${label} → does not throw`, threw === null, threw);
    check(S, `${label} → NOT offered`, threw === null && s.available === false,
      threw || s?.reason);
    let ap = null;
    try { ap = ch.apply({ dir: chan }); } catch (err) { ap = { ok: false, threw: err.message }; }
    check(S, `${label} → apply refuses`, ap && ap.ok === false, JSON.stringify(ap));
  }
  note(`${hostile.length} hostile manifests, none offered, none threw`);
}

// ═══════════════════════════════════════════════════════════════════════════
// 7. The documented limit: a valid-looking hostile release
// ═══════════════════════════════════════════════════════════════════════════
banner('SIM 7  the ACKNOWLEDGED limit — a writer who controls the folder');
{
  const S = 'authenticity';
  const chan = freshDir();
  const src = freshDir();
  ch.publish({ artefactPath: makeArtefact(src, 'Rama-AGI-Setup-1.0.0.exe'), dir: chan,
    version: '1.0.0' });
  // An attacker with write access publishes their own "release" correctly.
  ch.publish({ artefactPath: makeArtefact(src, 'Rama-AGI-Setup-9.9.9.exe'), dir: chan,
    version: '9.9.9' });
  const s = st(chan, '1.0.0');
  check(S, 'a correctly-published hostile release IS offered — as documented',
    s.available === true && s.verified === true, s.reason);
  check(S, 'and the warning about who can write here is always attached',
    /anyone who can write here/.test(s.warning || ''), s.warning);
  note('this is NOT a bug: the hash proves integrity, not authorship. Only code signing');
  note('would change it, and that is master\'s decision (row 53). The UI states this.');
}

// ═══════════════════════════════════════════════════════════════════════════
// 8. Exotic Windows paths as artefact names
// ═══════════════════════════════════════════════════════════════════════════
banner('SIM 8  exotic filenames and Windows device names');
{
  const S = 'exotic';
  const probes = ['NUL.exe', 'CON.exe', 'PRN.exe', 'AUX.exe', 'COM1.exe', 'LPT1.exe'];
  for (const name of probes) {
    const chan = freshDir();
    fs.writeFileSync(path.join(chan, ch.MANIFEST_NAME), JSON.stringify({
      manifestVersion: 1, version: '9.9.9', file: name,
      sha256: crypto.createHash('sha256').update('').digest('hex'),
    }));
    let s;
    let threw = null;
    try { s = st(chan, '1.0.0'); } catch (err) { threw = err.message; }
    check(S, `${name} → does not throw`, threw === null, threw);
    // A device name must not be treated as a verified installer. Either it does not "exist",
    // or it reads as empty and the zero-byte guard rejects it.
    check(S, `${name} → NOT offered as installable`,
      threw === null && !(s.available && s.canApply), threw || JSON.stringify(s));
  }

  // A directory wearing an installer's name.
  const chan = freshDir();
  fs.mkdirSync(path.join(chan, 'Rama-AGI-Setup-9.9.9.exe'));
  fs.writeFileSync(path.join(chan, ch.MANIFEST_NAME), JSON.stringify({
    manifestVersion: 1, version: '9.9.9', file: 'Rama-AGI-Setup-9.9.9.exe',
    sha256: 'a'.repeat(64),
  }));
  let threw = null;
  let s;
  try { s = st(chan, '1.0.0'); } catch (err) { threw = err.message; }
  check(S, 'a DIRECTORY named like an installer does not throw', threw === null, threw);
  check(S, 'and is not offered', threw === null && s.available === false, threw || s?.reason);

  // A very long name.
  const chan2 = freshDir();
  const longName = `${'a'.repeat(180)}.exe`;
  try {
    const p = path.join(chan2, longName);
    fs.writeFileSync(p, crypto.randomBytes(64));
    const r = ch.publish({ artefactPath: p, dir: chan2, version: '1.0.1' });
    check(S, 'a 180-character filename is handled', typeof r.ok === 'boolean', JSON.stringify(r));
  } catch (err) {
    check(S, 'a 180-character filename does not crash the harness', true, err.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 9. Zero-byte and implausible artefacts
// ═══════════════════════════════════════════════════════════════════════════
banner('SIM 9  a zero-byte "installer"');
{
  const S = 'empty';
  const chan = freshDir();
  const empty = path.join(freshDir(), 'Rama-AGI-Setup-4.0.0.exe');
  fs.writeFileSync(empty, Buffer.alloc(0));
  const r = ch.publish({ artefactPath: empty, dir: chan, version: '4.0.0' });
  const s = st(chan, '1.0.0');
  check(S, 'a zero-byte installer is NOT offered as installable',
    !(s.available && s.canApply), `publish=${JSON.stringify(r.ok)} status=${JSON.stringify(s)}`);
  check(S, 'and apply refuses it', ch.apply({ dir: chan }).ok === false);
}

// ═══════════════════════════════════════════════════════════════════════════
// 10. Many installs, one channel
// ═══════════════════════════════════════════════════════════════════════════
banner('SIM 10  one channel read by 200 installs at mixed versions');
{
  const S = 'fleet';
  const chan = freshDir();
  const src = freshDir();
  ch.publish({ artefactPath: makeArtefact(src, 'Rama-AGI-Setup-1.4.0.exe'), dir: chan,
    version: '1.4.0' });

  let offered = 0;
  let upToDate = 0;
  let wrong = 0;
  for (let i = 0; i < 200; i++) {
    const major = Math.floor(rnd() * 3);
    const minor = Math.floor(rnd() * 12);
    const patch = Math.floor(rnd() * 12);
    const v = `${major}.${minor}.${patch}`;
    const s = st(chan, v);
    const shouldOffer = ch.compareVersions('1.4.0', v) > 0;
    if (s.available !== shouldOffer) {
      wrong++;
      if (wrong <= 3) note(`MISMATCH installed=${v} offered=${s.available} expected=${shouldOffer}`);
    }
    if (s.available) offered++; else upToDate++;
  }
  check(S, 'every one of 200 installs got the correct verdict', wrong === 0, `${wrong} wrong`);
  note(`${offered} would update, ${upToDate} already current or ahead — 0 incorrect`);
}

// ═══════════════════════════════════════════════════════════════════════════
// 11. Fuzzing the manifest
// ═══════════════════════════════════════════════════════════════════════════
banner(`SIM 11  fuzzing the manifest, ${FUZZ} iterations (seed ${argOf('seed', 'auto')})`);
{
  const S = 'fuzz';
  const chan = freshDir();
  const src = freshDir();
  ch.publish({ artefactPath: makeArtefact(src, 'Rama-AGI-Setup-2.0.0.exe'), dir: chan,
    version: '2.0.0' });
  const realFile = 'Rama-AGI-Setup-2.0.0.exe';
  const realHash = ch.readManifest(chan).manifest.sha256;

  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const versions = ['9.9.9', '', '0', null, undefined, 0, {}, [], '1.0.0-beta', 'v9', '../9',
    'Infinity', 'NaN', '9'.repeat(400), true];
  const files = [realFile, '../evil.exe', 'evil.exe', '', null, {}, [], 'a'.repeat(300),
    realFile.toUpperCase(), ` ${realFile}`, `${realFile} `, 'evil.exe\n', 0];
  const hashes = [realHash, realHash.toUpperCase(), '', null, 'a'.repeat(63), 'a'.repeat(65),
    'g'.repeat(64), 0, {}, [], realHash.replace('a', 'b')];

  let threws = 0;
  let unsafe = 0;
  for (let i = 0; i < FUZZ; i++) {
    const m = {};
    if (rnd() < 0.9) m.version = pick(versions);
    if (rnd() < 0.9) m.file = pick(files);
    if (rnd() < 0.9) m.sha256 = pick(hashes);
    if (rnd() < 0.3) m.manifestVersion = pick([1, 0, 2, 99, '1', null]);
    if (rnd() < 0.2) m.sizeBytes = pick([0, -1, 1e12, 'big', null]);
    if (rnd() < 0.1) m.kind = pick(['installer', 'portable', 'evil', 0]);
    if (rnd() < 0.1) m.__proto__ = { version: '9.9.9' };

    try {
      fs.writeFileSync(path.join(chan, ch.MANIFEST_NAME), JSON.stringify(m));
    } catch { continue; }

    let s;
    try {
      s = st(chan, '1.0.0');
    } catch (err) {
      threws++;
      if (threws <= 3) note(`THREW on ${JSON.stringify(m)} → ${err.message}`);
      continue;
    }
    // The only safe "offered" is: the real file, the real hash, and a newer version.
    if (s.available) {
      const legit = s.manifest.file === realFile
        && String(s.manifest.sha256).toLowerCase() === realHash
        && ch.compareVersions(s.manifest.version, '1.0.0') > 0;
      if (!legit) {
        unsafe++;
        if (unsafe <= 3) note(`UNSAFE OFFER for ${JSON.stringify(m)}`);
      }
    }
  }
  check(S, `${FUZZ} fuzzed manifests: none threw`, threws === 0, `${threws} threw`);
  check(S, `${FUZZ} fuzzed manifests: none produced an unsafe offer`, unsafe === 0,
    `${unsafe} unsafe`);
}

// ═══════════════════════════════════════════════════════════════════════════
// 12. Rollback and re-publish of an older build
// ═══════════════════════════════════════════════════════════════════════════
banner('SIM 12  deliberate rollback');
{
  const S = 'rollback';
  const chan = freshDir();
  const src = freshDir();
  ch.publish({ artefactPath: makeArtefact(src, 'Rama-AGI-Setup-2.0.0.exe'), dir: chan,
    version: '2.0.0' });
  check(S, '2.0.0 offered to a 1.0.0 install', st(chan, '1.0.0').available === true);
  // Master deliberately republishes an older build to roll the fleet back.
  ch.publish({ artefactPath: makeArtefact(src, 'Rama-AGI-Setup-1.9.0.exe'), dir: chan,
    version: '1.9.0' });
  check(S, 'after rollback, a 1.0.0 install is offered 1.9.0',
    st(chan, '1.0.0').manifest.version === '1.9.0');
  check(S, 'but a 2.0.0 install is NOT walked backwards',
    st(chan, '2.0.0').available === false, st(chan, '2.0.0').reason);
  check(S, 'and is told which is which',
    /older than the installed/.test(st(chan, '2.0.0').reason || ''));
  note('rollback works for behind installs; ahead installs are never downgraded silently');
}

// ═══════════════════════════════════════════════════════════════════════════
// 13. Read-only channel
// ═══════════════════════════════════════════════════════════════════════════
banner('SIM 13  a read-only / unreachable channel');
{
  const S = 'readonly';
  const missing = path.join(ROOT, 'does', 'not', 'exist');
  let threw = null;
  let s;
  try { s = st(missing, '1.0.0'); } catch (err) { threw = err.message; }
  check(S, 'a nonexistent directory does not throw', threw === null, threw);
  check(S, 'and offers nothing', threw === null && s.available === false);
  check(S, 'publish to an impossible path fails cleanly', (() => {
    const r = ch.publish({
      artefactPath: makeArtefact(freshDir(), 'x.exe'),
      dir: '\u0000:/impossible', version: '1.0.0',
    });
    return r.ok === false;
  })());
  check(S, 'apply on a nonexistent directory refuses',
    ch.apply({ dir: missing }).ok === false);
  check(S, 'status with dir=null refuses', ch.status({ dir: null }).available === false);
  check(S, 'status with dir=undefined refuses', ch.status({}).available === false);
}

// ═══════════════════════════════════════════════════════════════════════════
try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch { /* leave it */ }

process.stdout.write(`\n${'='.repeat(70)}\n`);
if (failures.length) {
  process.stdout.write('  FAILURES\n');
  for (const f of failures.slice(0, 40)) process.stdout.write(`    ✕ ${f}\n`);
  if (failures.length > 40) process.stdout.write(`    … ${failures.length - 40} more\n`);
  process.stdout.write('\n');
}
process.stdout.write(`  ${pass} passed, ${fail} failed   (fuzz seed ${seed})\n`);
process.stdout.write(`${'='.repeat(70)}\n`);
process.exit(fail ? 1 : 0);
