#!/usr/bin/env node
'use strict';

/**
 * verifyUpgradeApplier.cjs — the create gate, and the applier's entry validation.
 *
 * ── THE DEFECT THIS SUITE IS BUILT AROUND ─────────────────────────────────────────────────────────
 *
 * On a SHIPPED install there is no allow-file, so the stop is engaged and every policy class resolves
 * to L0. An unconditional `policy.require('revert-own-apply', 'L4')` at the applier's entry therefore
 * REFUSED A MASTER-APPROVED APPLY ON EVERY INSTALL — and the row that would have caught it used an
 * allow-file fixture, so it never ran in the state a real install boots into. **The first assertions
 * below run with NO allow-file and NO policy file, and require master's apply to SUCCEED.**
 *
 * The companion defect is the other direction: deciding whether the stop applied by reading
 * `opts.autonomous`, which arrives from the renderer untouched. A predicate the caller supplies is
 * bypassable by omitting a field, so it is recorded and never read — asserted here both behaviourally
 * (an apply carrying the flag is treated identically to one without it) and on the source shape.
 *
 * ── AND THE TWO RESIDUALS, PRINTED RATHER THAN ARGUED AWAY ─────────────────────────────────────────
 *
 * In-process `proposals.create()` is not gated, and `electron/ipc/timeline.cjs`'s pre-existing
 * SELF_MODIFY applier writes `changes[].path` verbatim with no root confinement. Both are printed on
 * every run with what master would have to decide to close them.
 *
 * Run: node scripts/verifyUpgradeApplier.cjs   (or npm run verify:applier)
 */

const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');

const gate     = require('../electron/lib/autonomyGate.cjs');
const applier  = require('../electron/lib/upgradeApplier.cjs');
const stop     = require('../electron/lib/autonomyStop.cjs');
const policy   = require('../electron/lib/autonomyPolicy.cjs');
const ledger   = require('../electron/lib/proposals.cjs');

let pass = 0;
let fail = 0;
const failures = [];
const residuals = [];

const check = (label, ok, detail) => {
  if (ok) { pass += 1; console.log(`  PASS  ${label}`); }
  else {
    fail += 1;
    failures.push(`${label}${detail !== undefined ? ` — ${detail}` : ''}`);
    console.log(`  FAIL  ${label}${detail !== undefined ? ` — ${detail}` : ''}`);
  }
};
const residual = (msg) => { residuals.push(msg); console.log(`  RESIDUAL  ${msg}`); };
const read = (rel) => { try { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch { return ''; } };
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');

const MASTER = { name: 'master', tier: 0 };
const VIEWER = { name: 'operator', tier: 1 };
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const pid = () => crypto.randomBytes(10).toString('hex');

function scratch(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `rama-${name}-`));
  fs.mkdirSync(path.join(dir, stop.STATE_DIR), { recursive: true });
  return dir;
}
function repoFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rama-repo-'));
  fs.mkdirSync(path.join(root, 'electron', 'lib'), { recursive: true });
  fs.writeFileSync(path.join(root, 'electron', 'lib', 'target.cjs'), 'module.exports = 1;\n', 'utf8');
  return root;
}
function io(repoRoot, userDataRoot, extra = {}) {
  return { fs, repoRoot, userDataRoot, policy, guard: require('../electron/lib/loyaltyGuard.cjs'),
    capability: require('../electron/lib/capability.cjs'), ...extra };
}
function diffProposal(repoRoot, over = {}) {
  const target = path.join(repoRoot, 'electron', 'lib', 'target.cjs');
  const base = fs.existsSync(target) ? sha256(fs.readFileSync(target)) : null;
  return {
    id: pid(),
    kind: gate.KIND.DIFF,
    title: 'a pin',
    changes: [{ action: 'patch', path: 'electron/lib/target.cjs', content: 'module.exports = 2;\n', baseSha256: base }],
    meta: { schema: gate.SCHEMA },
    ...over,
  };
}

const savedEnv = process.env[stop.ENV_KEY];
delete process.env[stop.ENV_KEY];

console.log('\nthe create gate and the applier — the stop halts Rāma, never master\n');

async function main() {

// ─── 1. THE SHIPPED STATE: master's approved apply must succeed ───────────────
console.log('  the shipped state — no allow-file, no policy file');
{
  const userData = scratch('shipped');
  const repo = repoFixture();
  stop.configure({ userDataRoot: userData });
  policy.reload();
  check('the install really is stopped', stop.isStopped() === true);
  check('and every policy class really is L0', policy.CLASSES.every(c => policy.effective(c) === 'L0'));
  check('and the policy data file really is absent', fs.existsSync(policy.DATA_FILE) === false);

  const p = diffProposal(repo);
  let result = null;
  let threw = null;
  try { result = await applier.applyWith(io(repo, userData), p, { user: MASTER }); }
  catch (err) { threw = err.message; }
  check('A MASTER-APPROVED APPLY SUCCEEDS ON A SHIPPED INSTALL', threw === null && !!result, threw);
  check('and the bytes really changed on disk',
    fs.readFileSync(path.join(repo, 'electron', 'lib', 'target.cjs'), 'utf8') === 'module.exports = 2;\n');
  check('the result never claims a verification it did not run', result?.verification === 'not-run');
  check('and says so in words rather than leaving the field to be read as a pass',
    typeof result?.verificationNote === 'string' && result.verificationNote.length > 20);
  check('the snapshot landed under the DERIVED directory',
    result?.snapshotDir === path.join(userData, stop.STATE_DIR, stop.SNAPSHOT_DIR, p.id));
  check('and it holds the prior bytes, verified on read-back',
    fs.readFileSync(path.join(result.snapshotDir, 'files', 'electron', 'lib', 'target.cjs'), 'utf8') === 'module.exports = 1;\n');
}

// ─── 2. and again under the environment override ──────────────────────────────
console.log('\n  the second reachable form of the same defect: RAMA_AUTONOMY=stop over a valid allow-file');
{
  const userData = scratch('envstop');
  const repo = repoFixture();
  fs.writeFileSync(path.join(userData, stop.STATE_DIR, stop.ALLOW_FILE),
    JSON.stringify({ allowed: true, by: 'master', at: 'now', note: 'allowed' }), 'utf8');
  stop.configure({ userDataRoot: userData });
  process.env[stop.ENV_KEY] = 'stop';
  policy.reload();
  check('the stop is engaged by the environment', stop.isStopped() === true);
  let threw = null;
  try { await applier.applyWith(io(repo, userData), diffProposal(repo), { user: MASTER }); }
  catch (err) { threw = err.message; }
  check('master\'s apply still succeeds', threw === null, threw);
  delete process.env[stop.ENV_KEY];
}

// ─── 3. the flag is recorded, never read ──────────────────────────────────────
console.log('\n  opts.autonomous is a datum for the audit, not a gate');
{
  const userData = scratch('flag');
  const repoA = repoFixture();
  const repoB = repoFixture();
  stop.configure({ userDataRoot: userData });
  const withFlag = diffProposal(repoA);
  const without  = diffProposal(repoB);
  const a = await applier.applyWith(io(repoA, userData), withFlag, { user: MASTER, autonomous: true });
  const b = await applier.applyWith(io(repoB, userData), without, { user: MASTER });
  check('an apply carrying autonomous:true is treated identically to one without it',
    a.applied.length === b.applied.length && a.verification === b.verification && a.masterDriven === b.masterDriven);
  check('the claim is RECORDED', withFlag.meta.autonomy.flagFromOpts === true);
  check('and what the system decided is recorded separately, so both are auditable',
    withFlag.meta.autonomy.appliedBy === 'master' && withFlag.meta.autonomy.autonomousApply === false);
  check('and an absent flag records false rather than nothing', without.meta.autonomy.flagFromOpts === false);
  const repoC = repoFixture();
  const preserved = diffProposal(repoC);
  preserved.meta.autonomy = { appliedBy: 'someone', autonomousApply: true, note: 'pre-existing' };
  await applier.applyWith(io(repoC, userData), preserved, { user: MASTER });
  check('a field already in meta.autonomy survives the apply', preserved.meta.autonomy.note === 'pre-existing');
  check('and the two the audit depends on are set by the applier, not inherited',
    preserved.meta.autonomy.appliedBy === 'master' && preserved.meta.autonomy.autonomousApply === false);
  const code = strip(read('electron/lib/upgradeApplier.cjs'));
  check('meta.autonomy is MERGED, not assigned, so nothing already recorded is destroyed',
    /autonomy = \{\s*\n\s*\.\.\.\(proposal\.meta\.autonomy \|\| \{\}\)/.test(code));
  check('the flag never appears in a conditional',
    !/if\s*\([^)]*autonomous/.test(code) && !/autonomous\s*===\s*true\s*\)/.test(code.replace(/flagFromOpts: opts\?\.autonomous === true,/, '')));
  const optsReads = [...code.matchAll(/opts\?\.([a-zA-Z]+)/g)].map(m => m[1]);
  check('and the applier reads no opts member other than user and autonomous',
    optsReads.every(k => applier.RECOGNISED_OPTS.includes(k)), optsReads.join(', '));
}

// ─── 4. the snapshot directory is derived, never read from the record ─────────
console.log('\n  the snapshot directory is DERIVED — a persisted one is display-only');
{
  const userData = scratch('derived');
  const repo = repoFixture();
  stop.configure({ userDataRoot: userData });
  const allow = path.join(userData, stop.STATE_DIR, stop.ALLOW_FILE);
  fs.writeFileSync(allow, JSON.stringify({ allowed: true, by: 'master', at: 'now', note: 'watch me' }), 'utf8');
  const before = fs.readFileSync(allow);

  const p = diffProposal(repo);
  // The poisoned record: a directory that would put the applier's writes beside the stop's own state.
  p.meta.weighing = { blastRadius: { rollbackPoint: { kind: 'file-snapshot', dir: path.join(userData, stop.STATE_DIR) } } };
  const result = await applier.applyWith(io(repo, userData), p, { user: MASTER });
  check('the snapshot still went to the derived directory, not the persisted one',
    result.snapshotDir === path.join(userData, stop.STATE_DIR, stop.SNAPSHOT_DIR, p.id));
  check('and the allow-file is byte-identical afterwards', Buffer.compare(before, fs.readFileSync(allow)) === 0);
  const code = strip(read('electron/lib/upgradeApplier.cjs'));
  check('the applier never reads rollbackPoint at all — the absence is the guarantee',
    !/rollbackPoint/.test(code));
  check('and the only directory it writes to is built from the proposal id',
    /path\.join\(userDataRoot, stop\.STATE_DIR, stop\.SNAPSHOT_DIR, proposal\.id\)/.test(code));
  check('a malformed proposal id is refused before any path is built',
    applier.PID.source === '^[0-9a-f]{20}$');
}

// ─── 5. the seven entry validations ───────────────────────────────────────────
console.log('\n  the applier refuses at the door, and the ledger records FAILED');
{
  const userData = scratch('entry');
  stop.configure({ userDataRoot: userData });

  const cases = [
    ['no user at all', (repo) => [diffProposal(repo), {}], /authenticated tier-0 user/],
    ['a tier-1 user', (repo) => [diffProposal(repo), { user: VIEWER }], /authenticated tier-0 user/],
    ['a string user', (repo) => [diffProposal(repo), { user: 'master' }], /authenticated tier-0 user/],
    ['a malformed proposal id', (repo) => [diffProposal(repo, { id: 'nope' }), { user: MASTER }], /malformed proposal id/],
    ['no schema marker', (repo) => [diffProposal(repo, { meta: {} }), { user: MASTER }], /meta\.schema/],
    ['no changes at all', (repo) => [diffProposal(repo, { changes: [] }), { user: MASTER }], /at least one change/],
    ['a protected loyalty file', (repo) => [diffProposal(repo, {
      changes: [{ action: 'patch', path: 'electron/lib/loyaltyGuard.cjs', content: 'x', baseSha256: 'a'.repeat(64) }],
    }), { user: MASTER }], /loyalty covenant/],
    ['the policy module itself', (repo) => [diffProposal(repo, {
      changes: [{ action: 'patch', path: 'electron/lib/autonomyPolicy.cjs', content: 'x', baseSha256: 'a'.repeat(64) }],
    }), { user: MASTER }], /govern the autonomy policy or the stop/],
    ['the policy DATA file', (repo) => [diffProposal(repo, {
      changes: [{ action: 'create', path: 'shared/autonomy-policy.json', content: '{}' }],
    }), { user: MASTER }], /govern the autonomy policy or the stop/],
    ['the stop\'s own allow-file, by absolute path', (repo) => [diffProposal(repo, {
      changes: [{ action: 'create', path: path.join(userData, stop.STATE_DIR, stop.ALLOW_FILE), content: '{"allowed":true}' }],
    }), { user: MASTER }], /govern the autonomy policy or the stop/],
    ['a path outside the repository root', (repo) => [diffProposal(repo, {
      changes: [{ action: 'create', path: path.join(os.tmpdir(), 'escape.txt'), content: 'x' }],
    }), { user: MASTER }], /outside the repository root/],
    ['a traversal out of the root', (repo) => [diffProposal(repo, {
      changes: [{ action: 'create', path: '../../escape.txt', content: 'x' }],
    }), { user: MASTER }], /outside the repository root/],
    ['action delete', (repo) => [diffProposal(repo, {
      changes: [{ action: 'delete', path: 'electron/lib/target.cjs' }],
    }), { user: MASTER }], /only patch and create/],
    ['an unknown action', (repo) => [diffProposal(repo, {
      changes: [{ action: 'append', path: 'electron/lib/target.cjs', content: 'x' }],
    }), { user: MASTER }], /only patch and create/],
    ['a create whose path already exists', (repo) => [diffProposal(repo, {
      changes: [{ action: 'create', path: 'electron/lib/target.cjs', content: 'x' }],
    }), { user: MASTER }], /mis-declared patch/],
    ['a patch of a file that is not there', (repo) => [diffProposal(repo, {
      changes: [{ action: 'patch', path: 'electron/lib/absent.cjs', content: 'x', baseSha256: 'a'.repeat(64) }],
    }), { user: MASTER }], /nothing to patch/],
    ['a patch with no baseSha256', (repo) => [diffProposal(repo, {
      changes: [{ action: 'patch', path: 'electron/lib/target.cjs', content: 'x' }],
    }), { user: MASTER }], /no baseSha256/],
    ['a patch whose base has drifted', (repo) => [diffProposal(repo, {
      changes: [{ action: 'patch', path: 'electron/lib/target.cjs', content: 'x', baseSha256: 'b'.repeat(64) }],
    }), { user: MASTER }], /base-drift/],
    ['a change with no content string', (repo) => [diffProposal(repo, {
      changes: [{ action: 'patch', path: 'electron/lib/target.cjs', content: null, baseSha256: 'a'.repeat(64) }],
    }), { user: MASTER }], /carries no content|base-drift/],
  ];

  for (const [label, build, expected] of cases) {
    const repo = repoFixture();
    const [proposal, opts] = build(repo);
    const original = fs.readFileSync(path.join(repo, 'electron', 'lib', 'target.cjs'), 'utf8');
    let message = null;
    try { await applier.applyWith(io(repo, userData), proposal, opts); }
    catch (err) { message = err.message; }
    check(`${label} is refused, by name`, message !== null && expected.test(message), message ?? 'it was applied');
    check(`and ${label} wrote nothing`,
      fs.readFileSync(path.join(repo, 'electron', 'lib', 'target.cjs'), 'utf8') === original);
  }

  const symRepo = repoFixture();
  let symlinked = false;
  try {
    fs.symlinkSync(path.join(os.tmpdir(), 'elsewhere.cjs'), path.join(symRepo, 'electron', 'lib', 'link.cjs'));
    symlinked = true;
  } catch { symlinked = false; }
  if (symlinked) {
    let message = null;
    try {
      await applier.applyWith(io(symRepo, userData), diffProposal(symRepo, {
        changes: [{ action: 'patch', path: 'electron/lib/link.cjs', content: 'x', baseSha256: 'a'.repeat(64) }],
      }), { user: MASTER });
    } catch (err) { message = err.message; }
    check('a symlinked target is refused — resolve-then-compare is not enough on its own',
      message !== null && /symlink/.test(message), message ?? 'it was applied');
  } else {
    residual('a symlink could not be created on this machine, so the lstat rule is asserted on source only');
    check('the lstat rule is in the source', /isSymbolicLink\(\)/.test(read('electron/lib/upgradeApplier.cjs')));
  }
}

// ─── 6. the revert ────────────────────────────────────────────────────────────
console.log('\n  the revert restores the recorded prior state, and a token is the authority');
{
  const userData = scratch('revert');
  stop.configure({ userDataRoot: userData });
  check('a revert with no token is refused', applier.revert(null).ok === false);
  check('a revert with a forged token shape is refused',
    applier.revert({ proposalId: 'nope', dir: userData, snapshot: { files: [] } }).ok === false);

  const repo = repoFixture();
  const p = diffProposal(repo);
  const result = await applier.applyWith(io(repo, userData), p, { user: MASTER });
  const token = { proposalId: p.id, dir: result.snapshotDir, at: 'now', snapshot: { files: result.files } };
  const undone = applier.revert(token, io(repo, userData));
  check('a patched file is restored to its recorded bytes', undone.ok === true
    && fs.readFileSync(path.join(repo, 'electron', 'lib', 'target.cjs'), 'utf8') === 'module.exports = 1;\n');

  const repo2 = repoFixture();
  const created = diffProposal(repo2, {
    changes: [{ action: 'create', path: 'electron/lib/new.cjs', content: 'module.exports = 3;\n' }],
  });
  const r2 = await applier.applyWith(io(repo2, userData), created, { user: MASTER });
  check('a created file exists after the apply', fs.existsSync(path.join(repo2, 'electron', 'lib', 'new.cjs')));
  const undone2 = applier.revert({ proposalId: created.id, dir: r2.snapshotDir, at: 'now', snapshot: { files: r2.files } },
    io(repo2, userData));
  check('and reverting a CREATE removes it, because "the prior bytes" has no meaning for it',
    undone2.ok === true && fs.existsSync(path.join(repo2, 'electron', 'lib', 'new.cjs')) === false);

  // A write that fails mid-apply. `fails` counts how many times the second target refuses: once for a
  // transient error the revert can undo, forever for the fatal case.
  function twoFileFixture(failTimes) {
    const repo = repoFixture();
    fs.writeFileSync(path.join(repo, 'electron', 'lib', 'second.cjs'), 'module.exports = 9;\n', 'utf8');
    const first = path.join(repo, 'electron', 'lib', 'target.cjs');
    const second = path.join(repo, 'electron', 'lib', 'second.cjs');
    let refused = 0;
    const failingFs = Object.assign(Object.create(Object.getPrototypeOf(fs)), fs, {
      writeFileSync: (p, data, enc) => {
        if (String(p) === second && refused < failTimes) { refused += 1; throw new Error('disk full'); }
        return fs.writeFileSync(p, data, enc);
      },
    });
    const proposal = {
      id: pid(), kind: gate.KIND.DIFF, title: 'two', meta: { schema: gate.SCHEMA },
      changes: [
        { action: 'patch', path: 'electron/lib/target.cjs', content: 'module.exports = 2;\n', baseSha256: sha256(fs.readFileSync(first)) },
        { action: 'patch', path: 'electron/lib/second.cjs', content: 'module.exports = 8;\n', baseSha256: sha256(fs.readFileSync(second)) },
      ],
    };
    return { repo, first, second, failingFs, proposal };
  }

  const transient = twoFileFixture(1);
  let message = null;
  try { await applier.applyWith(io(transient.repo, userData, { fs: transient.failingFs }), transient.proposal, { user: MASTER }); }
  catch (err) { message = err.message; }
  check('a failed write is reverted and says so', message !== null && /reverted/.test(message), message);
  check('and the file that HAD been written is back to its prior bytes',
    fs.readFileSync(transient.first, 'utf8') === 'module.exports = 1;\n');

  // And a revert that CANNOT complete is fatal: it says so, keeps the evidence, and engages the stop.
  const fatalUserData = scratch('fatal');
  stop.configure({ userDataRoot: fatalUserData });
  fs.writeFileSync(path.join(fatalUserData, stop.STATE_DIR, stop.ALLOW_FILE),
    JSON.stringify({ allowed: true, by: 'master', at: 'now', note: 'allowed' }), 'utf8');
  const doomed = twoFileFixture(Infinity);
  let fatalMessage = null;
  try { await applier.applyWith(io(doomed.repo, fatalUserData, { fs: doomed.failingFs }), doomed.proposal, { user: MASTER }); }
  catch (err) { fatalMessage = err.message; }
  check('a revert that cannot complete is FATAL and says so', fatalMessage !== null && /FATAL/.test(fatalMessage), fatalMessage);
  const fatalDir = path.join(fatalUserData, stop.STATE_DIR, stop.SNAPSHOT_DIR, doomed.proposal.id);
  check('the evidence is marked so it is never evicted', fs.existsSync(path.join(fatalDir, 'fatal.json')));
  check('and the stop was engaged with the reason, which is the most important datum at that moment',
    stop.isHalted() === true
    && /revert failed/.test(JSON.parse(fs.readFileSync(stop.stoppedRecordPath(), 'utf8')).reason));
  check('the prior allow-file survives inside the stopped-record rather than being destroyed',
    JSON.parse(fs.readFileSync(stop.stoppedRecordPath(), 'utf8')).priorAllow?.note === 'allowed');
  stop.configure({ userDataRoot: userData });
}

// ─── 7. retention ─────────────────────────────────────────────────────────────
console.log('\n  snapshots are purged on both bounds, and a fatal one never is');
{
  const userData = scratch('evict');
  const root = path.join(userData, stop.STATE_DIR, stop.SNAPSHOT_DIR);
  fs.mkdirSync(root, { recursive: true });
  const made = [];
  for (let i = 0; i < 25; i += 1) {
    const dir = path.join(root, pid());
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'rollback.json'), '{}', 'utf8');
    const when = Date.now() - i * 60_000;
    fs.utimesSync(dir, when / 1000, when / 1000);
    made.push(dir);
  }
  const old = path.join(root, pid());
  fs.mkdirSync(old, { recursive: true });
  const ancient = Date.now() - 31 * 24 * 60 * 60 * 1000;
  fs.utimesSync(old, ancient / 1000, ancient / 1000);
  const fatal = path.join(root, pid());
  fs.mkdirSync(fatal, { recursive: true });
  fs.writeFileSync(path.join(fatal, 'fatal.json'), '{}', 'utf8');
  fs.utimesSync(fatal, ancient / 1000, ancient / 1000);
  const notAnId = path.join(root, 'something-else');
  fs.mkdirSync(notAnId, { recursive: true });

  const out = applier.evictSnapshots({ fs, root, now: Date.now() });
  check('the count is reported rather than applied silently', typeof out.evicted === 'number' && out.evicted > 0);
  check('no more than the 20 most recent survive',
    fs.readdirSync(root).filter(n => applier.PID.test(n) && n !== path.basename(fatal)).length <= 20);
  check('a 31-day-old entry is gone even though it was within the count', fs.existsSync(old) === false);
  check('a fatal entry is never evicted — it is the only record of what the tree was meant to be',
    fs.existsSync(fatal) === true);
  check('and a directory that is not a proposal id is left alone', fs.existsSync(notAnId) === true);
}

// ─── 8. the create gate: origin is derived, never supplied ────────────────────
console.log('\n  the create gate — origin is a literal at the call site, never a field');
{
  const userData = scratch('gate');
  stop.configure({ userDataRoot: userData });
  let threw = false;
  try { gate.inspectCreate({ kind: 'self-modify' }, {}); } catch { threw = true; }
  check('an undeclared origin THROWS rather than being guessed', threw === true);
  let threw2 = false;
  try { gate.inspectCreate({ kind: 'self-modify' }, { origin: 'renderer' }); } catch { threw2 = true; }
  check('and an invented origin is refused too', threw2 === true);
  const gateCode = strip(read('electron/lib/autonomyGate.cjs'));
  check('origin is never read out of the definition',
    !/def\??\.origin/.test(gateCode) && !/def\.autonomous/.test(gateCode));
  check('the two call sites pass it as a literal',
    /origin: 'ipc'/.test(gateCode) && /origin: 'rama'/.test(gateCode));
}

// ─── 9. what an IPC create may and may not do ─────────────────────────────────
console.log('\n  over IPC: pre-existing kinds unchanged (I11), this design\'s kinds refused');
{
  const userData = scratch('ipc');
  stop.configure({ userDataRoot: userData });
  const channels = new Map();
  const fakeIpc = { handle: (ch, fn) => channels.set(ch, fn) };
  ledger.register(gate.guardLedgerIpc(fakeIpc));
  check('every ledger channel is still registered through the wrapper', channels.size >= 9);
  for (const ch of ['proposals:list', 'proposals:get', 'proposals:create', 'proposals:approve',
    'proposals:reject', 'proposals:apply', 'proposals:stats', 'proposals:audit', 'proposals:flush']) {
    check(`${ch} is registered`, channels.has(ch));
  }
  const create = channels.get('proposals:create');

  const shipped = await create({}, {
    user: VIEWER, kind: 'self-modify', title: 'a change master asked for',
    changes: [{ action: 'patch', path: 'src/pages/Home/Home.jsx', content: 'x' }],
  });
  check('a self-modify create from the renderer still works, exactly as before (I11)', shipped.ok === true);
  check('and a tier-2 user is still refused by the ledger\'s own view gate',
    (await create({}, { user: { tier: 2 }, kind: 'self-modify', changes: [] })).ok === false);

  const forged = await create({}, { user: MASTER, kind: gate.KIND.DIFF, meta: { schema: gate.SCHEMA }, changes: [] });
  check('a hand-built self-upgrade entry is refused at the door', forged.ok === false
    && /filed by Rāma's self-maintenance loop/.test(forged.error), forged.error);
  const forgedQuestion = await create({}, { user: MASTER, kind: gate.KIND.QUESTION, changes: [] });
  check('and so is a hand-built self-upgrade question', forgedQuestion.ok === false);

  for (const [label, def] of [
    ['the policy data file', { changes: [{ action: 'create', path: 'shared/autonomy-policy.json', content: '{}' }] }],
    ['the policy module', { changes: [{ action: 'patch', path: 'electron/lib/autonomyPolicy.cjs', content: 'x' }] }],
    ['the stop module', { changes: [{ action: 'patch', path: 'electron/lib/autonomyStop.cjs', content: 'x' }] }],
    ['the tripwire manifest', { changes: [{ action: 'patch', path: 'shared/loyalty-tripwire.json', content: '{}' }] }],
    ['the allow-file by absolute path', { changes: [{ action: 'create', path: path.join(userData, stop.STATE_DIR, stop.ALLOW_FILE), content: '{}' }] }],
    ['the stopped-record', { changes: [{ action: 'create', path: path.join(userData, stop.STATE_DIR, stop.STOPPED_RECORD), content: '{}' }] }],
    ['the snapshot directory', { changes: [{ action: 'create', path: `${userData}/rama/upgrade-snapshots/x/y.cjs`, content: '{}' }] }],
    ['a governed path hidden in meta', { changes: [], meta: { note: 'write to electron/lib/autonomyStop.cjs' } }],
  ]) {
    const res = await create({}, { user: MASTER, kind: 'self-modify', title: label, ...def });
    check(`a create naming ${label} is refused — for EVERY kind, not only this design's`,
      res.ok === false && /govern the autonomy policy or the stop/.test(res.error), res.error);
  }
}

// ─── 10. the in-process path: stop first, then policy ─────────────────────────
console.log('\n  fileProposal — the only path by which Rāma may file one of these kinds');
{
  const userData = scratch('file');
  stop.configure({ userDataRoot: userData });
  policy.reload();
  let created = 0;
  const counting = { create: (def) => { created += 1; return { id: pid(), ...def }; } };

  const stopped = gate.fileProposal(counting, { kind: gate.KIND.QUESTION, title: 'a question', changes: [] });
  check('with no allow-file it files NOTHING and says the stop is why',
    stopped.ok === false && stopped.stopped === true && /autonomy is stopped/.test(stopped.reason));
  check('and the ledger was never reached', created === 0);

  fs.writeFileSync(path.join(userData, stop.STATE_DIR, stop.ALLOW_FILE),
    JSON.stringify({ allowed: true, by: 'master', at: 'now', note: 'allowed' }), 'utf8');
  policy.reload();
  const question = gate.fileProposal(counting, { kind: gate.KIND.QUESTION, title: 'a question', changes: [] });
  check('once allowed, a QUESTION is filed — propose-question\'s floor is L3',
    question.ok === true && created === 1);
  check('and the schema marker is stamped by the gate, not trusted from the caller',
    question.data.meta.schema === gate.SCHEMA);

  const diff = gate.fileProposal(counting, {
    kind: gate.KIND.DIFF, title: 'a diff',
    changes: [{ action: 'patch', path: 'electron/lib/target.cjs', content: 'x' }],
  });
  check('a DIFF is refused, because propose-source ships at L1 and needs L3',
    diff.ok === false && diff.blocked === true && diff.classId === 'propose-source' && diff.need === 'L3', diff.reason);
  check('and the refusal is a sentence master can act on', /propose-source/.test(diff.reason) && /L3/.test(diff.reason));
  check('the ledger was still not reached', created === 1);

  const governed = gate.fileProposal(counting, {
    kind: gate.KIND.DIFF, title: 'promotion',
    changes: [{ action: 'create', path: 'shared/autonomy-policy.json', content: '{"version":1}' }],
  });
  check('Rāma may not file a change to its own policy even when autonomy is allowed',
    governed.ok === false && governed.refused === true);
  check('a kind this design does not own is refused by this path',
    gate.fileProposal(counting, { kind: 'self-modify', changes: [] }).ok === false);
  check('and the classes a filing maps to are declared data',
    gate.classFor({ kind: gate.KIND.QUESTION }).classId === 'propose-question'
    && gate.classFor({ kind: gate.KIND.DIFF, changes: [{}], meta: { findingClass: 'dependency-change' } }).classId === 'dependency-change'
    && gate.classFor({ kind: gate.KIND.DIFF, changes: [{}], meta: { findingClass: 'invented' } }).classId === 'propose-source');
}

// ─── 11. the wiring, and the absence that holds "Rāma does not start an apply" ─
console.log('\n  the wiring in main.cjs, and who can reach proposals.apply');
{
  const mainSrc = read('electron/main.cjs');
  check('the ledger\'s IPC is registered through the gate wrapper',
    /proposalLedger\.register\(\s*\n?\s*isStub\(autonomyGate\) \? ipcRec : autonomyGate\.guardLedgerIpc\(ipcRec\)\)/.test(mainSrc));
  check('and a failed gate load degrades to the previous behaviour rather than unregistering the ledger',
    /isStub\(autonomyGate\) \? ipcRec/.test(mainSrc));
  check('the applier is registered, after the ledger', /upgradeApplier\.register\(proposalLedger\)/.test(mainSrc)
    && mainSrc.indexOf('Approval ledger') < mainSrc.indexOf('Upgrade applier'));
  check('and it adds a kind rather than replacing one',
    /registerApplier\(KIND\.DIFF/.test(read('electron/lib/upgradeApplier.cjs')));

  const callSites = [];
  for (const dir of ['electron/lib', 'electron/ipc', 'electron']) {
    let names = [];
    try { names = fs.readdirSync(path.join(ROOT, dir)).filter(f => f.endsWith('.cjs')); } catch { names = []; }
    for (const name of names) {
      const rel = `${dir}/${name}`;
      const src = strip(read(rel));
      const re = /(?:proposals|ledger|proposalLedger)\.apply\s*\(/g;
      let m;
      while ((m = re.exec(src)) !== null) {
        const before = src.slice(Math.max(0, m.index - 700), m.index);
        callSites.push({ rel, insideHandler: /ipcMain\.handle\(/.test(before) });
      }
    }
  }
  check('every call site of proposals.apply sits inside an IPC handler — none is reached from a timer or a loop',
    callSites.length > 0 && callSites.every(c => c.insideHandler),
    callSites.filter(c => !c.insideHandler).map(c => c.rel).join(', '));
  check('and there are exactly the two that were measured, so a third demands a review',
    callSites.length === 2, callSites.map(c => c.rel).join(', '));
}

// ─── 12. the residuals ────────────────────────────────────────────────────────
console.log('\n  what this does NOT close');
{
  const timeline = strip(read('electron/ipc/timeline.cjs'));
  const unconfined = /registerApplier\(ledger\.KINDS\.SELF_MODIFY[\s\S]{0,700}?writeFileSync\(change\.path/.test(timeline);
  if (unconfined) {
    residual('electron/ipc/timeline.cjs\'s pre-existing SELF_MODIFY applier writes changes[].path verbatim — '
      + 'no resolve-then-compare, no lstat, and fs.rmSync for a delete. So an in-process create naming an '
      + 'absolute path still writes wherever the process can write. Confining it would change a shipped '
      + 'applier\'s behaviour and refusing delete would remove a capability (I11), so it is MASTER\'S DECISION. '
      + 'The renderer route is closed by autonomyGate; the in-process route is not.');
  }
  check('and the suite reports that rather than claiming the stop is unreachable by any proposal',
    unconfined === true);
  residual('proposals.create() is reachable in-process by five existing callers and is NOT gated — '
    + 'proposals.cjs is protected, so the IPC seam and the applier\'s entry validation are the two gates '
    + 'this design can own.');
  const guard = require('../electron/lib/loyaltyGuard.cjs');
  const missing = policy.SELF_GOVERNING_PATHS.map(p => p.path).filter(p => !guard.PROTECTED_FILES.includes(p));
  if (missing.length) {
    residual(`for master: add ${missing.join(', ')} to loyaltyGuard.PROTECTED_FILES and to the tripwire `
      + 'manifest, plus the capability entries "system.suspend-autonomy": 0 and "autonomy.view": 1. '
      + 'loyaltyGuard.cjs and shared/capabilities.json are protected, so this build cannot do it.');
  }
  check('no verification plan is claimed to run, anywhere in the applier',
    !/verified:\s*true/.test(read('electron/lib/upgradeApplier.cjs')));
}

// ─── 13. EVERY SPELLING OF A GOVERNED PATH, AT EVERY GATE ─────────────────────
//
// The hole this section exists to close, measured end to end before it was fixed: the path fence
// compared strings that had only had their separators swapped and a leading './' stripped, so
// 'electron/lib/./autonomyStop.cjs', 'electron//lib/autonomyStop.cjs' and
// 'electron/lib/../lib/autonomyStop.cjs' all read as naming nothing governed. A self-upgrade proposal
// with a correct baseSha256 and a tier-0 user was applied against a fixture repo with no refusal, and
// the stop module on disk afterwards read `function isStopped(){return false;}`. autonomyStop.cjs is
// not in loyaltyGuard.PROTECTED_FILES, so nothing downstream objected; the renderer create path returned
// no refusal either. I6 held — the apply still needed master's recorded approval — but the diff should
// never have been fileable.
//
// So: every variant of every one of the four SELF_GOVERNING_PATHS, at inspectCreate for BOTH origins
// and at applyWith, with the write that would have landed asserted NOT to have landed. The control row
// at the end applies the same spelling to an UNGOVERNED path, so a green section cannot mean "the gate
// refuses odd-looking paths" when what is claimed is "the gate resolves them".
console.log('\n  the path fence resolves structure — every spelling of a governed path is refused');
{
  const userData = scratch('variants');
  stop.configure({ userDataRoot: userData });

  function governedRepoFixture() {
    const root = repoFixture();
    fs.mkdirSync(path.join(root, 'shared'), { recursive: true });
    fs.writeFileSync(path.join(root, 'electron', 'lib', 'autonomyStop.cjs'),
      'function isStopped(){return true;}\n', 'utf8');
    fs.writeFileSync(path.join(root, 'electron', 'lib', 'autonomyPolicy.cjs'), 'module.exports = {};\n', 'utf8');
    fs.writeFileSync(path.join(root, 'shared', 'autonomy-policy.json'), '{"version":1,"levels":{}}\n', 'utf8');
    fs.writeFileSync(path.join(root, 'shared', 'loyalty-tripwire.json'), '{}\n', 'utf8');
    return root;
  }

  /** The spellings that reduce to the same file. Generated from the path, so a fifth path is covered too. */
  function variants(rel) {
    const dir = path.posix.dirname(rel);
    const base = path.posix.basename(rel);
    return [
      [`${dir}/./${base}`,                                     'a "." segment'],
      [`${dir}//${base}`,                                      'a doubled separator'],
      [`${dir}/../${path.posix.basename(dir)}/${base}`,         'a ".." that comes back'],
      [`./${rel}`,                                             'a leading "./"'],
      [`${rel.split('/').join('\\').replace(/\\([^\\]+)$/, '\\.\\$1')}`, 'backslashes and a "." segment'],
    ];
  }

  const PAYLOAD = 'function isStopped(){return false;}\n';
  let variantRows = 0;

  for (const entry of policy.SELF_GOVERNING_PATHS) {
    for (const [spelling, shape] of variants(entry.path)) {
      variantRows += 1;

      // (i) the renderer create path
      const fromIpc = gate.inspectCreate(
        { kind: 'self-modify', changes: [{ action: 'patch', path: spelling, content: PAYLOAD }] },
        { origin: 'ipc' });
      check(`IPC create: "${spelling}" (${shape}) is refused`,
        fromIpc?.refused === true && /govern the autonomy policy or the stop/.test(fromIpc.reason),
        fromIpc?.reason ?? 'it was allowed');

      // (ii) Rāma's own create path
      const fromRama = gate.inspectCreate(
        { kind: gate.KIND.DIFF, changes: [{ action: 'patch', path: spelling, content: PAYLOAD }] },
        { origin: 'rama' });
      check(`Rāma's create: "${spelling}" is refused for naming a governed path, not merely for the stop`,
        fromRama?.refused === true && /govern the autonomy policy or the stop/.test(fromRama.reason),
        fromRama?.reason ?? 'it was allowed');

      // (iii) and the same spelling hidden in meta, which is persisted and rehydrated on an id check
      const inMeta = gate.inspectCreate(
        { kind: 'self-modify', changes: [], meta: { plan: `then patch ${spelling}` } },
        { origin: 'ipc' });
      check(`and in meta: "${spelling}" is refused there too`,
        inMeta?.refused === true, inMeta?.reason ?? 'it was allowed');
    }
  }
  check('all four self-governing paths were covered, in five spellings each',
    variantRows === policy.SELF_GOVERNING_PATHS.length * 5 && variantRows === 20, String(variantRows));

  // (iv) the applier, where the bytes would actually land
  for (const entry of policy.SELF_GOVERNING_PATHS) {
    for (const [spelling] of variants(entry.path)) {
      const repo = governedRepoFixture();
      const target = path.join(repo, ...entry.path.split('/'));
      const before = fs.readFileSync(target, 'utf8');
      const proposal = {
        id: pid(), kind: gate.KIND.DIFF, title: 'a governed path, spelled around the fence',
        meta: { schema: gate.SCHEMA },
        changes: [{ action: 'patch', path: spelling, content: PAYLOAD, baseSha256: sha256(fs.readFileSync(target)) }],
      };
      let message = null;
      try { await applier.applyWith(io(repo, userData), proposal, { user: MASTER }); }
      catch (err) { message = err.message; }
      check(`applyWith: "${spelling}" is refused at step 3`,
        message !== null && /govern the autonomy policy or the stop/.test(message),
        message ?? 'it was applied');
      check(`and ${entry.path} is byte-identical on disk afterwards`,
        fs.readFileSync(target, 'utf8') === before);
    }
  }

  // (v) THE CONTROL. The same spellings, an ungoverned path — these must APPLY. Without this row a
  // green section above would be satisfied by a fence that refuses anything with a "." or a ".." in it,
  // which is a different and much blunter guarantee than the one being claimed.
  for (const [spelling, shape] of variants('electron/lib/target.cjs')) {
    const repo = governedRepoFixture();
    const target = path.join(repo, 'electron', 'lib', 'target.cjs');
    const proposal = {
      id: pid(), kind: gate.KIND.DIFF, title: 'an ungoverned path, same spelling',
      meta: { schema: gate.SCHEMA },
      changes: [{ action: 'patch', path: spelling, content: 'module.exports = 2;\n', baseSha256: sha256(fs.readFileSync(target)) }],
    };
    let message = null;
    try { await applier.applyWith(io(repo, userData), proposal, { user: MASTER }); }
    catch (err) { message = err.message; }
    check(`control: an UNGOVERNED path written with ${shape} still applies`, message === null, message);
    check('and the bytes really changed, so the fence resolves paths rather than rejecting odd ones',
      fs.readFileSync(target, 'utf8') === 'module.exports = 2;\n');
  }

  const gateCode = strip(read('electron/lib/autonomyGate.cjs'));
  check('the comparison canonicalises by resolution before it compares',
    /path\.posix\.normalize/.test(gateCode));
  check('and an empty path still names nothing, rather than normalising to the repository root',
    gate.namesGovernedPath('') === null && gate.namesGovernedPath(null) === null
    && gate.namesGovernedPath('.') === null);
}

// ─── 14. the data file cannot refuse master's apply either ────────────────────
// The companion door to §1: with revert-own-apply merely EDITABLE, a validated data edit lowering it to
// L0 made this applier's entry gate throw on a MASTER-APPROVED apply — the §1 defect, reached through a
// documented edit instead of through the stop.
console.log('\n  a real shared/autonomy-policy.json cannot refuse master\'s approved apply');
{
  const userData = scratch('policyfile');
  stop.configure({ userDataRoot: userData });
  if (fs.existsSync(policy.DATA_FILE)) {
    residual(`${policy.DATA_FILE} already exists, so these rows were SKIPPED rather than overwrite `
      + 'master\'s own policy file. Move it aside and re-run to exercise them.');
  } else {
    try {
      for (const [label, body] of [
        ['lowering revert-own-apply to L0', { version: 1, levels: { 'revert-own-apply': 'L0' } }],
        ['lowering both MASTER_ACT classes', { version: 1, levels: { 'revert-own-apply': 'L0', 'apply-source': 'L0' } }],
        ['a legitimate restriction of an editable class', { version: 1, levels: { 'research-network': 'L1' } }],
      ]) {
        fs.writeFileSync(policy.DATA_FILE, JSON.stringify(body, null, 2), 'utf8');
        const repo = repoFixture();
        const p = diffProposal(repo);
        let threw = null;
        try { await applier.applyWith(io(repo, userData), p, { user: MASTER }); }
        catch (err) { threw = err.message; }
        check(`with a data file ${label}, A MASTER-APPROVED APPLY STILL SUCCEEDS`, threw === null, threw);
        check('and the bytes landed',
          fs.readFileSync(path.join(repo, 'electron', 'lib', 'target.cjs'), 'utf8') === 'module.exports = 2;\n');
      }
    } finally {
      try { fs.unlinkSync(policy.DATA_FILE); } catch { /* already gone, which is the shipped state */ }
      policy.reload();
    }
    check('and the data file is absent again, exactly as it ships',
      fs.existsSync(policy.DATA_FILE) === false);
  }
}

}

main()
  .then(() => {
    stop.configure({ userDataRoot: null });
    if (savedEnv === undefined) delete process.env[stop.ENV_KEY];
    else process.env[stop.ENV_KEY] = savedEnv;
    if (residuals.length) {
      console.log(`\n  ${residuals.length} residual(s) printed above — held by master, not by this suite`);
    }
    console.log(`\n  ${pass} passed, ${fail} failed\n`);
    if (fail > 0) {
      console.log('  FAILURES');
      for (const f of failures) console.log(`    - ${f}`);
      process.exit(1);
    }
  })
  .catch((err) => {
    console.error(`\n  the suite itself threw: ${err.stack || err.message}\n`);
    process.exit(1);
  });
