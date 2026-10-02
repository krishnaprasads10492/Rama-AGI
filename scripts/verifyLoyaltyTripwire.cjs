'use strict';

/**
 * verifyLoyaltyTripwire.cjs — the loyalty core cannot change quietly.
 *
 * ── WHAT THIS ADDS THAT THE RUNTIME GUARD DOES NOT ────────────────────────────────────────────────
 *
 * `loyaltyGuard.PROTECTED_FILES` already refuses SELF_MODIFY, REGEN and EVOLUTION proposals that touch
 * the seven files constituting the guard. That closes the path where Rāma proposes a change to its own
 * loyalty machinery and an applier writes it.
 *
 * Section 124 §6.2 found what it does NOT close: **the boundary is open indirectly.** A protected file
 * can still change via an applier that never consults the guard, a build script, an update-channel
 * payload, a dependency that rewrites source, a merge, or a plain editor. In every one of those cases
 * nothing in the repository notices. There is no source-integrity attestation anywhere — that was the
 * finding, and this is the answer to it.
 *
 * So this is a different kind of check from the runtime guard, and the two are complementary:
 *   runtime guard  — "this PROPOSAL may not touch those files"
 *   this tripwire   — "those files are byte-for-byte what master last approved, whatever route a change
 *                      might have taken to get here"
 *
 * ── THE TWO-RECORD RULE, AND WHY ONE RECORD WOULD BE THEATRE ──────────────────────────────────────
 *
 * The manifest records a SHA-256 per protected file **and** a `manifestDigest` computed over all of
 * them. Both must agree with what is on disk. A single record would mean that whoever changed the file
 * could update its digest in the same edit and the tripwire would approve of itself. With two records
 * the edit has to be made twice, in two shapes, and both show up in the diff as a deliberate act.
 *
 * ── WHY `--approve` CANNOT BE RUN BLIND ───────────────────────────────────────────────────────────
 *
 * A tripwire with an automatic "regenerate the manifest" button is not a tripwire; it is a speed bump
 * with a ramp. So `--approve` refuses unless the environment carries the exact digest being approved:
 *
 *     $env:RAMA_MASTER_APPROVAL = '<the manifestDigest printed by the failure>'
 *     node scripts/verifyLoyaltyTripwire.cjs --approve --note "why"
 *
 * Master therefore has to read the digest the suite computed and hand it back. You cannot approve a
 * change to the loyalty core without having looked at what you are approving — which is the whole
 * point, and is the same posture as `dependencyAdvisor`, which proposes and never upgrades (I12), and
 * `charge_watch`, where a headline never writes a rate (Section 116).
 *
 * ── WHAT THIS DOES NOT CLAIM ──────────────────────────────────────────────────────────────────────
 *
 * This proves the FILES are unchanged. It does not prove they are correct, and it is not a signature:
 * anyone who can edit the repository can also run `--approve` if they can read the digest. It raises
 * the act from invisible to recorded, and `git log` is then the audit trail. A cryptographic signature
 * over the manifest needs a key that is master's alone, which is a decision he has not been asked yet
 * and is recorded as next work rather than assumed.
 *
 * Run: node scripts/verifyLoyaltyTripwire.cjs        (or npm run verify:tripwire)
 */

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const MANIFEST = path.join(ROOT, 'shared', 'loyalty-tripwire.json');

let pass = 0;
let fail = 0;
const failures = [];

const check = (label, ok, detail) => {
  if (ok) { pass += 1; console.log(`  PASS  ${label}`); }
  else {
    fail += 1;
    failures.push(`${label}${detail !== undefined ? ` — ${detail}` : ''}`);
    console.log(`  FAIL  ${label}${detail !== undefined ? ` — ${detail}` : ''}`);
  }
};

/**
 * ONE definition of what is protected. Read from the guard rather than restated here, because a second
 * list is how two lists come to disagree — which is exactly the defect I8 exists to prevent, and a
 * tripwire guarding a stale list is worse than none.
 */
function protectedFiles() {
  const guard = require(path.join(ROOT, 'electron', 'lib', 'loyaltyGuard.cjs'));
  return [...guard.PROTECTED_FILES].sort();
}

/** Newline-normalised, so a CRLF checkout is not a loyalty incident. */
function digestOf(rel) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) return null;
  const text = fs.readFileSync(abs, 'utf8').replace(/\r\n/g, '\n');
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function digestsNow() {
  const out = {};
  for (const rel of protectedFiles()) out[rel] = digestOf(rel);
  return out;
}

/** The second record: one digest over all the others, so a single-file edit cannot self-approve. */
function manifestDigestOf(files) {
  const canonical = Object.keys(files).sort()
    .map((k) => `${k}:${files[k]}`)
    .join('\n');
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
}

function readManifest() {
  try { return JSON.parse(fs.readFileSync(MANIFEST, 'utf8')); }
  catch { return null; }
}

// ─── approve ──────────────────────────────────────────────────────────────────

function approve() {
  const files = digestsNow();
  const missing = Object.keys(files).filter((k) => files[k] === null);
  if (missing.length > 0) {
    console.error(`\n  Refusing: protected files are missing — ${missing.join(', ')}\n`);
    process.exit(1);
  }
  const want = manifestDigestOf(files);
  const supplied = process.env.RAMA_MASTER_APPROVAL || '';

  if (supplied !== want) {
    console.error('\n  REFUSING TO APPROVE BLIND.\n');
    console.error('  The loyalty core\'s current state hashes to:\n');
    console.error(`      ${want}\n`);
    console.error('  To approve it, hand that digest back deliberately:\n');
    console.error(`      $env:RAMA_MASTER_APPROVAL = '${want}'`);
    console.error('      node scripts/verifyLoyaltyTripwire.cjs --approve --note "<why>"\n');
    console.error('  An approval you did not have to read is not an approval.\n');
    process.exit(1);
  }

  const noteAt = process.argv.indexOf('--note');
  const note = noteAt > -1 ? String(process.argv[noteAt + 1] || '') : '';
  if (!note.trim()) {
    console.error('\n  Refusing: --note is required. An approval with no stated reason is a change\n'
      + '  nobody can review later.\n');
    process.exit(1);
  }

  const prev = readManifest();
  const manifest = {
    _comment: 'Byte-level attestation of the loyalty core (invariants I15/I16). Changed ONLY by '
      + 'scripts/verifyLoyaltyTripwire.cjs --approve, which refuses unless the approver hands back '
      + 'the digest being approved. See the header of that file.',
    version: 1,
    approvedAt: new Date().toISOString(),
    note: note.trim(),
    previousManifestDigest: prev ? prev.manifestDigest || null : null,
    files,
    manifestDigest: want,
  };
  fs.mkdirSync(path.dirname(MANIFEST), { recursive: true });
  fs.writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(`\n  Approved and recorded: ${want}`);
  console.log(`  ${MANIFEST}`);
  console.log('\n  Commit this file in the same commit as the change it approves.\n');
}

// ─── verify ───────────────────────────────────────────────────────────────────

function verify() {
  console.log('\nloyalty tripwire — the core cannot change quietly\n');

  const guardList = protectedFiles();
  check('the protected-file list comes from loyaltyGuard, not from a second copy here',
    guardList.length > 0, guardList.length);
  check('and it still names the loyalty core and the guard itself',
    guardList.includes('electron/lib/loyaltyCore.cjs')
    && guardList.includes('electron/lib/loyaltyGuard.cjs'));
  check('and the sealer, which is where I15 is enforced',
    guardList.includes('electron/nucleusSealer.cjs'));
  check('and the capability matrix, which decides who is master',
    guardList.includes('shared/capabilities.json'));

  const manifest = readManifest();
  if (!manifest) {
    check('an approved manifest exists', false,
      `${path.relative(ROOT, MANIFEST)} is missing. Run --approve to record the current state.`);
    return;
  }
  check('an approved manifest exists', true);
  check('it records when it was approved', typeof manifest.approvedAt === 'string');
  check('and why', typeof manifest.note === 'string' && manifest.note.length > 0);

  const now = digestsNow();
  const gone = Object.keys(now).filter((k) => now[k] === null);
  check('every protected file is present on disk', gone.length === 0, gone.join(', '));

  // The list itself is attested: adding a protected file without approving it, or quietly dropping
  // one from the guard, both fail here.
  const recorded = Object.keys(manifest.files || {}).sort();
  const added = guardList.filter((f) => !recorded.includes(f));
  const removed = recorded.filter((f) => !guardList.includes(f));
  check('the guard protects exactly the files the manifest approved',
    added.length === 0 && removed.length === 0,
    [added.length ? `newly protected and unapproved: ${added.join(', ')}` : '',
      removed.length ? `no longer protected: ${removed.join(', ')}` : ''].filter(Boolean).join('; '));

  // RECORD ONE: per-file digests.
  const changed = [];
  for (const rel of recorded) {
    if (!(rel in now)) continue;
    if (now[rel] !== manifest.files[rel]) changed.push(rel);
  }
  check('no protected file has changed since master approved it',
    changed.length === 0, changed.join(', '));

  // RECORD TWO: the digest over all of them. A per-file edit that also rewrote its own digest is
  // caught here, which is the point of keeping two records rather than one.
  const expected = manifestDigestOf(manifest.files || {});
  check('the manifest\'s own digest matches the digests it lists',
    manifest.manifestDigest === expected,
    `recorded ${String(manifest.manifestDigest).slice(0, 12)}…, computed ${expected.slice(0, 12)}…`);

  const live = manifestDigestOf(now);
  check('and the live core hashes to the approved manifest digest',
    live === manifest.manifestDigest,
    `live ${live.slice(0, 12)}…, approved ${String(manifest.manifestDigest).slice(0, 12)}…`);

  if (changed.length > 0 || live !== manifest.manifestDigest) {
    console.log('\n  THE LOYALTY CORE DOES NOT MATCH ITS APPROVAL.');
    console.log('  This is either a change master approved and has not recorded, or a change he did');
    console.log('  not make. Review the diff on the files above BEFORE recording anything, then:\n');
    console.log(`      $env:RAMA_MASTER_APPROVAL = '${live}'`);
    console.log('      node scripts/verifyLoyaltyTripwire.cjs --approve --note "<why>"\n');
  }
}

// ─── Run ──────────────────────────────────────────────────────────────────────

if (process.argv.includes('--approve')) {
  approve();
} else {
  verify();
  console.log(`\n  ${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.log('\n  failures:');
    for (const x of failures) console.log(`    - ${x}`);
    process.exit(1);
  }
  console.log('\n  ALL PASS — the loyalty core is byte-for-byte what master approved\n');
}
