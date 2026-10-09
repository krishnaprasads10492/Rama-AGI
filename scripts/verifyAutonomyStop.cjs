#!/usr/bin/env node
'use strict';

/**
 * verifyAutonomyStop.cjs — the stop halts Rāma, never master, and the permanent classes cannot be raised.
 *
 * THE THREE THINGS THIS SUITE EXISTS TO CATCH
 *
 * 1. **A fail-safe default that deletes working behaviour.** `ollama-catalog`, `dependency-review`, the
 *    metacognition audit, selfCare's 120-second sweep and marketIntel's two ticks ship and run today.
 *    Governing them with the fail-safe predicate would remove five behaviours on every install until
 *    master hand-created a file nobody told him about — a regression wearing a fail-safe argument, which
 *    I11 has no exception for. The row below proves a default install still dispatches, with a counting
 *    fake rather than an argument.
 *
 * 2. **A permanent class promoted by a data edit.** The six permanent classes are enumerated in a frozen
 *    constant and the editable set is DERIVED from it, so moving one into the editable set turns the
 *    literal-list row RED. The loader also rejects a data file that so much as names one.
 *
 * 3. **A label that lies.** `statusText()` must name both halves in both states, because the one thing
 *    that must never happen is "stopped" printed over five live timers — `badgeLabel`'s defect, in the
 *    place it would be least acceptable.
 *
 * WHY LINE CITATIONS ARE A RESIDUAL AND NOT A ROW
 *
 * `PRE_EXISTING` carries measured line numbers. The SYMBOL still existing is asserted (RED if it is
 * gone — a named dispatcher that does not exist is the badge defect inverted). A DRIFTED LINE NUMBER is
 * printed as a residual instead, because an unrelated edit higher up one of those files is not a loyalty
 * defect and should not turn another author's build red.
 *
 * Run: node scripts/verifyAutonomyStop.cjs   (or npm run verify:autonomy)
 */

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const stop   = require('../electron/lib/autonomyStop.cjs');
const policy = require('../electron/lib/autonomyPolicy.cjs');

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

const read = (rel) => {
  try { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch { return ''; }
};

/** A scratch userData root, so no assertion below can read or write master's real state. */
function scratch(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `rama-${name}-`));
  fs.mkdirSync(path.join(dir, stop.STATE_DIR), { recursive: true });
  return dir;
}
function writeAllow(root, body) {
  fs.writeFileSync(path.join(root, stop.STATE_DIR, stop.ALLOW_FILE),
    typeof body === 'string' ? body : JSON.stringify(body), 'utf8');
}

const savedEnv = process.env[stop.ENV_KEY];
delete process.env[stop.ENV_KEY];

console.log('\nthe autonomy stop and the policy table — the fence, asserted\n');

// 1. the module can always load
console.log('  a stop that can fail to load is not a stop');
const stopSrc = read('electron/lib/autonomyStop.cjs');
const stopCode = stopSrc.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
check('autonomyStop requires nothing at module scope but fs, path and os',
  /^const fs\s+= require\('fs'\);$/m.test(stopSrc)
  && !/^const .*require\('electron'\)/m.test(stopCode)
  && !/^const .*require\('\.\.\/dataStore/m.test(stopCode));
check('and reaches electron only inside a try, for the userData path',
  /try \{\s*\n\s*const \{ app \} = require\('electron'\)/.test(stopCode));
check('and reaches the capability matrix only inside lift()',
  (stopCode.match(/require\('\.\/capability\.cjs'\)/g) || []).length === 1);
check('it holds no timer of its own — it describes, it does not schedule',
  !/setInterval|setTimeout/.test(stopCode));

// 2. fail-safe: absence means stopped
console.log('\n  isStopped() — absence of configuration means STOPPED');
{
  const root = scratch('failsafe');
  stop.configure({ userDataRoot: root });
  check('no allow-file at all means stopped', stop.isStopped() === true);
  for (const [label, body] of [
    ['a zero-byte file', ''],
    ['invalid JSON', '{'],
    ['the string "true"', { allowed: 'true' }],
    ['the number 1', { allowed: 1 }],
    ['an empty object', {}],
    ['null', 'null'],
    ['allowed: false', { allowed: false }],
  ]) {
    writeAllow(root, body);
    check(`${label} means stopped`, stop.isStopped() === true);
  }
  writeAllow(root, { allowed: true, by: 'master', at: new Date().toISOString(), note: 'test' });
  check('only the boolean true allows autonomy', stop.isStopped() === false);

  fs.mkdirSync(path.join(root, stop.STATE_DIR, 'dir-in-the-way'), { recursive: true });
  const dirRoot = scratch('dir');
  fs.mkdirSync(path.join(dirRoot, stop.STATE_DIR, stop.ALLOW_FILE), { recursive: true });
  stop.configure({ userDataRoot: dirRoot });
  check('a directory at the allow-file path means stopped', stop.isStopped() === true);
}

// 3. the env override, checked first
console.log('\n  the environment override outranks a valid allow-file');
{
  const root = scratch('env');
  writeAllow(root, { allowed: true, by: 'master', at: 'now', note: 'valid' });
  stop.configure({ userDataRoot: root });
  check('a valid allow-file allows autonomy', stop.isStopped() === false);
  process.env[stop.ENV_KEY] = 'stop';
  check('RAMA_AUTONOMY=stop stops it anyway', stop.isStopped() === true);
  check('and halts the pre-existing dispatchers too', stop.isHalted() === true);
  process.env[stop.ENV_KEY] = 'STOP';
  check('the check is case-insensitive', stop.isStopped() === true);
  delete process.env[stop.ENV_KEY];
  check('removing it restores the allow-file\'s answer', stop.isStopped() === false);
}

// 4. the two predicates are genuinely two
console.log('\n  two predicates, and collapsing them back into one goes red');
{
  const root = scratch('two');
  stop.configure({ userDataRoot: root });
  check('a default install is STOPPED for new autonomous work', stop.isStopped() === true);
  check('and NOT halted for the work that already ships', stop.isHalted() === false);
  check('isStopped never reads the stopped-record, so its absence never implies autonomy is running',
    !/isStopped[\s\S]{0,400}?stoppedRecordPath/.test(stopCode.slice(stopCode.indexOf('function isStopped'), stopCode.indexOf('function isHalted'))));
  const engaged = stop.engage('a test', 'verifyAutonomyStop');
  check('engage() records the halt', engaged.ok === true && engaged.recorded === true);
  check('and the record carries the reason and who', engaged.record.reason === 'a test' && engaged.record.by === 'verifyAutonomyStop');
  check('now the pre-existing dispatchers are halted', stop.isHalted() === true);
  check('and the new work is still stopped', stop.isStopped() === true);
  check('engage() declares that it performed no teardown, rather than implying it did',
    engaged.teardown.performed === false && typeof engaged.teardown.reason === 'string');
}

// 5. engage records BEFORE it destroys
console.log('\n  engage() records before it destroys');
{
  const root = scratch('order');
  const allow = { allowed: true, by: 'master (tier 0)', at: '2026-02-14T09:31:04.000Z', note: 'why' };
  writeAllow(root, allow);
  stop.configure({ userDataRoot: root });
  const engaged = stop.engage('a fatal revert', 'upgradeApplier');
  check('the allow-file is gone', fs.existsSync(stop.allowPath()) === false);
  check('and its contents survive inside the stopped-record',
    engaged.record.priorAllow?.note === 'why' && engaged.record.priorAllow?.by === 'master (tier 0)');
  const onDisk = JSON.parse(fs.readFileSync(stop.stoppedRecordPath(), 'utf8'));
  check('the record is on disk, not only in the return value', onDisk.reason === 'a fatal revert');
  check('the write ordering is record-then-unlink in source, so a crash leaves the recoverable state',
    stopCode.indexOf('writeFileSync(stoppedRecordPath()') < stopCode.indexOf('unlinkSync(allowPath()'));
}

// 6. lift() degrades honestly, and Rāma can never call it
console.log('\n  lift() — the only gated direction');
{
  const root = scratch('lift');
  stop.configure({ userDataRoot: root });
  check('a string user is refused — a name is not an identity',
    stop.lift('master', 'because').ok === false);
  check('a user with no numeric tier is refused', stop.lift({ name: 'x' }, 'because').ok === false);
  const refused = stop.lift({ name: 'master', tier: 0 }, 'because');
  check('even tier 0 is refused, because system.suspend-autonomy is not in the matrix',
    refused.ok === false && refused.missingCapability === 'system.suspend-autonomy');
  check('and the refusal names the file master must write instead',
    refused.error.includes(stop.ALLOW_FILE));
  const matrix = JSON.parse(read('shared/capabilities.json'));
  check('the capability really is absent, so the degradation is the live state',
    matrix.capabilities['system.suspend-autonomy'] === undefined);
  const libs = fs.readdirSync(path.join(ROOT, 'electron', 'lib'))
    .concat(fs.readdirSync(path.join(ROOT, 'electron', 'ipc')).map(f => path.join('..', 'ipc', f)));
  const callers = libs.filter((f) => {
    if (!f.endsWith('.cjs') || f.endsWith('autonomyStop.cjs')) return false;
    const src = f.startsWith('..')
      ? read(path.join('electron', 'ipc', path.basename(f)))
      : read(path.join('electron', 'lib', f));
    return /\.lift\s*\(/.test(src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ''));
  });
  check('zero in-process callers of lift() — the absence is the guarantee, not a comment',
    callers.length === 0, callers.join(', '));
}

// 7. the empty note, and the ordering on the way back
console.log('\n  the resume path, asserted on the source because the capability blocks the behaviour');
{
  const liftBody = stopCode.slice(stopCode.indexOf('function lift('));
  check('an empty note is refused', /String\(note \|\| ''\)\.trim\(\)/.test(liftBody) && /requires a note/.test(liftBody));
  check('the allow-file is written BEFORE the stopped-record is removed, so a crash leaves "allowed but still halted"',
    liftBody.indexOf('writeFileSync(allowPath()') < liftBody.indexOf('unlinkSync(stoppedRecordPath()'));
  check('and lift() clears the halt rather than leaving an undoable one',
    /unlinkSync\(stoppedRecordPath\(\)\)/.test(liftBody));
}

// 8. what the stop governs, and what it must not
console.log('\n  the dispatch points, enumerated — the member that behaves differently is declared');
check('every declared list is frozen',
  Object.isFrozen(stop.CHOKEPOINTS) && Object.isFrozen(stop.PRE_EXISTING)
  && Object.isFrozen(stop.DEFERRED_CHOKEPOINTS) && Object.isFrozen(stop.MASTER_DRIVEN_ENTRIES)
  && Object.isFrozen(stop.STOP_EXEMPT) && Object.isFrozen(stop.FUTURE_ENTRIES));
check('one new chokepoint consults isStopped()', stop.CHOKEPOINTS.length === 1
  && stop.CHOKEPOINTS[0].predicate === 'isStopped');
check('and it is the proposal-create path, which is where this slice puts the gate',
  stop.CHOKEPOINTS[0].fn === 'fileProposal');
check('the five deferred stage functions are declared absent rather than silently missing',
  stop.DEFERRED_CHOKEPOINTS.length === 5);
for (const d of stop.DEFERRED_CHOKEPOINTS) {
  check(`${path.basename(d.module)} really is absent, so the chokepoint count cannot overclaim`,
    fs.existsSync(path.join(ROOT, d.module)) === false);
}
for (const f of stop.FUTURE_ENTRIES) {
  check(`the future autonomous entry ${path.basename(f.module)}:${f.fn} is named and ABSENT`,
    fs.existsSync(path.join(ROOT, f.module)) === false);
}
check('the one master-driven entry is declared WITH its reason',
  stop.MASTER_DRIVEN_ENTRIES.length === 1 && stop.MASTER_DRIVEN_ENTRIES[0].reason.length > 60);
check('the one exemption is declared with its reason',
  stop.STOP_EXEMPT.length === 1 && /only reaps/.test(stop.STOP_EXEMPT[0].reason));

console.log('\n  the four pre-existing dispatchers — named, measured, and NOT governed by the fail-safe predicate');
check('four of them are enumerated', stop.PRE_EXISTING.length === 4);
for (const d of stop.PRE_EXISTING) {
  const src = read(d.module);
  check(`${d.module} still exists`, src.length > 0);
  check(`and still contains ${d.fn}, so the enumeration names something real`,
    new RegExp(d.fn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(src));
  const lines = src.split('\n');
  const cited = lines[d.citedLine - 1] || '';
  if (!cited.includes(d.fn)) {
    const actual = lines.findIndex(l => l.includes(d.fn)) + 1;
    residual(`${d.module}'s citation for ${d.fn} says line ${d.citedLine}; it now reads line ${actual || 'unknown'}`);
  }
  check(`${d.fn} DECLARES isHalted() as the predicate it will consult — the field, not the wiring`,
    d.governedByWhenBuilt === 'isHalted');
  check(`and this build does not tear it down, which is declared rather than assumed`,
    d.haltedByEngage === false && typeof d.why === 'string' && d.why.length > 20);
  const code = src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  check(`${path.basename(d.module)} is untouched by the stop — no isStopped() reaches it`,
    !/isStopped\s*\(/.test(code));
}
// And the honest half of those four rows, asserted rather than left to be inferred from the field name:
// isHalted() has NO production consumer. The four rows above record an intention, and the day one of
// those dispatchers starts consulting it is the day this row has to be rewritten — which is the point.
{
  const dirs = [['electron', 'lib'], ['electron', 'ipc'], ['electron']];
  const consumers = [];
  for (const parts of dirs) {
    let names = [];
    try { names = fs.readdirSync(path.join(ROOT, ...parts)).filter(f => f.endsWith('.cjs')); } catch { names = []; }
    for (const name of names) {
      if (name === 'autonomyStop.cjs') continue;
      const src = read(path.join(...parts, name)).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      if (/isHalted\s*\(/.test(src)) consumers.push(path.join(...parts, name));
    }
  }
  check('isHalted() has no production consumer yet, so governedByWhenBuilt names an intention and the '
    + 'header must not claim a mechanism', consumers.length === 0, consumers.join(', '));
  check('and the module header says exactly that, in words',
    /NOTHING CALLS IT YET/.test(stopSrc) && /governedByWhenBuilt/.test(stopSrc));
}

// 9. the behavioural proof for I11
async function provePreExistingStillDispatches() {
  console.log('\n  I11, measured: a default install still dispatches the work that already ships');
  const root = scratch('i11');
  stop.configure({ userDataRoot: root });
  const scheduler = require('../electron/lib/refreshScheduler.cjs');
  const saved = {};
  scheduler.useStore({
    get: (domain, key) => saved[`${domain}.${key}`],
    set: (domain, key, value) => { saved[`${domain}.${key}`] = value; },
    saveDomain: () => {},
  });
  let ran = 0;
  scheduler.register({
    name: 'stop-suite-probe', label: 'probe', intervalMs: 60_000,
    run: async () => { ran += 1; return { ok: true }; },
  });
  check('the stop reports this install as stopped for new autonomous work', stop.isStopped() === true);
  check('and not halted', stop.isHalted() === false);
  await scheduler.runNow('stop-suite-probe');
  check('refreshScheduler.runNow still called the task — ollama-catalog and dependency-review keep running',
    ran === 1);
  const before = JSON.stringify(saved);
  await scheduler.runNow('stop-suite-probe', { now: Date.now() + 1000 });
  check('and it is still recording outcomes rather than silently skipping',
    ran === 2 && JSON.stringify(saved) !== before);
  scheduler.unregister('stop-suite-probe');
}

// 10. the label describes what is true
function rest() {
console.log('\n  statusText() — both halves, by name, in both states');
{
  const root = scratch('label');
  stop.configure({ userDataRoot: root });
  const shipped = stop.statusText();
  check('the shipped state says the loop is stopped', /loop is stopped/.test(shipped), shipped);
  check('and names the allow-file master must create', shipped.includes(stop.ALLOW_FILE));
  check('and says the pre-existing work is still running, by name',
    /Still running on their own schedule/.test(shipped) && /ollama-catalog/.test(shipped), shipped);
  check('and names the missing capability instead of offering a dead button',
    /system\.suspend-autonomy/.test(shipped));
  stop.engage('an operator halt', 'tray');
  const halted = stop.statusText();
  check('after an engage it reports the halt and its reason', /an operator halt/.test(halted), halted);
  check('and does NOT claim the timers were torn down', /Still ARMED/.test(halted), halted);
  check('and says how to undo it without a working lift', halted.includes(stop.STOPPED_RECORD));
  writeAllow(root, { allowed: true, by: 'master', at: 'now', note: 'allowed' });
  const allowed = stop.statusText();
  check('with an allow-file it says the loop is allowed, and by whom', /loop is allowed \(master/.test(allowed), allowed);
}

// 11. the policy table: shape and arithmetic
console.log('\n  the policy table — fifteen classes over frozen floors, ceilings and permanence');
check('fifteen classes', policy.CLASSES.length === 15);
check('every class has a floor and a ceiling',
  policy.CLASSES.every(c => policy.FLOORS[c] && policy.CEILINGS[c]));
check('floor <= ceiling for every class',
  policy.CLASSES.every(c => policy.rank(policy.FLOORS[c]) <= policy.rank(policy.CEILINGS[c])));
check('no ceiling is L5 — the top rung is declared and unreachable',
  policy.CLASSES.every(c => policy.CEILINGS[c] !== 'L5'));
check('every class Rāma INITIATES has a floor no higher than L3',
  policy.RAMA_INITIATED.every(c => policy.rank(policy.FLOORS[c]) <= policy.rank('L3')));
check('the three frozen tables really are frozen',
  Object.isFrozen(policy.CLASSES) && Object.isFrozen(policy.FLOORS)
  && Object.isFrozen(policy.CEILINGS));
// `Object.freeze(new Set([...]))` freezes PROPERTIES, not internal slots: with the sets exported
// directly, `Object.isFrozen(policy.PERMANENT)` returned true while `policy.PERMANENT.delete(...)`
// succeeded and dropped the size from 7 to 6 — after which a data file naming that class VALIDATED.
// So the clause that read `Object.isFrozen` is replaced by what it was supposed to mean: no mutator
// exists, mutating a copy changes nothing, and the membership rows below carry the actual guarantee.
check('the two membership views expose no mutator at all, so a delete throws instead of succeeding',
  typeof policy.PERMANENT.delete === 'undefined' && typeof policy.PERMANENT.add === 'undefined'
  && typeof policy.PERMANENT.clear === 'undefined' && typeof policy.MASTER_ACT.delete === 'undefined'
  && typeof policy.MASTER_ACT.add === 'undefined');
{
  const sizeBefore = policy.PERMANENT.size;
  const copy = new Set([...policy.PERMANENT]);
  copy.delete('revert-own-apply');
  check('copying the view and mutating the copy leaves the exported view untouched',
    copy.size === sizeBefore - 1 && policy.PERMANENT.size === sizeBefore
    && policy.PERMANENT.has('revert-own-apply') === true);
  check('and the loader still rejects a file naming that class, which is what the mutation used to buy',
    policy.validate({ version: 1, levels: { 'revert-own-apply': 'L0' } }).ok === false);
  let assignmentHeld = true;
  try { policy.PERMANENT.has = () => false; } catch { assignmentHeld = false; }
  check('the view itself is frozen, so its has() cannot be swapped for one that answers false',
    policy.PERMANENT.has('master-record') === true, `assignment ${assignmentHeld ? 'was ignored' : 'threw'}`);
}
const status = policy.policyStatus();
check('seven permanent, eight editable, and the arithmetic is printed',
  status.counts.permanent === 7 && status.counts.editable === 8
  && status.counts.permanent + status.counts.editable === 15);
check('exactly four classes are raisable at all, and only to L3',
  status.counts.raisable === 4
  && ['propose-source', 'dependency-change', 'build-repair', 'author-change']
    .every(c => policy.CEILINGS[c] === 'L3' && policy.rank(policy.FLOORS[c]) < policy.rank('L3')));

// 12. THE ROW THAT GOES RED IF A PERMANENT CLASS IS MADE EDITABLE
console.log('\n  the permanent classes are mechanically unraisable');
const EXPECTED_PERMANENT = [
  'apply-source', 'revert-own-apply', 'release-classify', 'capability-grant', 'loyalty-core',
  'master-record', 'autonomy-policy',
];
check('the permanent set is exactly the seven expected ids — moving one out turns this RED',
  EXPECTED_PERMANENT.length === policy.PERMANENT.size
  && EXPECTED_PERMANENT.every(c => policy.PERMANENT.has(c)),
  [...policy.PERMANENT].join(', '));
check('what is recorded about master is one of them (spec Section 127)', policy.PERMANENT.has('master-record'));
check('and the editable set is DERIVED, so it cannot disagree with the permanent one',
  policy.EDITABLE.every(c => !policy.PERMANENT.has(c))
  && policy.EDITABLE.length + policy.PERMANENT.size === policy.CLASSES.length);
check('the editable list is frozen too', Object.isFrozen(policy.EDITABLE));
for (const c of EXPECTED_PERMANENT) {
  check(`a data file naming "${c}" is rejected WHOLE`,
    policy.validate({ version: 1, levels: { [c]: 'L4' } }).ok === false);
}
check('and a file mixing one forbidden raise with four legitimate lowerings lands NOTHING',
  policy.validate({ version: 1, levels: {
    'research-network': 'L1', 'propose-question': 'L1', 'propose-source': 'L1',
    'build-repair': 'L1', 'apply-source': 'L5',
  } }).ok === false);

console.log('\n  and the loader refuses everything else that would be a quiet promotion');
for (const [label, raw] of [
  ['an unknown class id', { version: 1, levels: { 'invent-a-class': 'L3' } }],
  ['L5 anywhere', { version: 1, levels: { 'propose-source': 'L5' } }],
  ['a level above the ceiling', { version: 1, levels: { 'propose-source': 'L4' } }],
  ['a level that is not a level', { version: 1, levels: { 'propose-source': 'high' } }],
  ['a non-string level', { version: 1, levels: { 'propose-source': 3 } }],
  ['a missing version', { levels: {} }],
  ['a version other than 1', { version: 2, levels: {} }],
  ['an extra top-level key', { version: 1, levels: {}, allowAll: true }],
  ['an array', []],
]) {
  check(`${label} is rejected`, policy.validate(raw).ok === false);
}
check('a legitimate raise of one of the four is accepted',
  policy.validate({ version: 1, levels: { 'propose-source': 'L3' } }).ok === true);
check('and so is a restriction below the floor, which is master putting Rāma offline',
  policy.validate({ version: 1, levels: { 'research-network': 'L1' } }).ok === true);

// 13. the resolver, with the stop dominating
console.log('\n  effective() — the stop is the first line, and nothing routes around it');
{
  const root = scratch('resolve');
  stop.configure({ userDataRoot: root });
  policy.reload();
  check('with no allow-file every one of the fifteen is L0',
    policy.CLASSES.every(c => policy.effective(c) === 'L0'));
  check('and the shipped policy file really is absent, so the floors are the shipped levels',
    policy.load().source === 'absent' && fs.existsSync(policy.DATA_FILE) === false);
  writeAllow(root, { allowed: true, by: 'master', at: 'now', note: 'allowed' });
  check('once autonomy is allowed, every class resolves to its floor',
    policy.CLASSES.every(c => policy.effective(c) === policy.FLOORS[c]));
  check('research-network is L2 — its honest current level', policy.effective('research-network') === 'L2');
  check('propose-question is L3 — dependencyAdvisor already files these daily',
    policy.effective('propose-question') === 'L3');
  check('revert-own-apply is L4, because a safety net\'s "nothing configured" level must be "works"',
    policy.effective('revert-own-apply') === 'L4');
  check('propose-source is L1, so the first unlock is a pure data change',
    policy.effective('propose-source') === 'L1');

  // A fixture file, resolved through loadFrom/effectiveFrom so no setter can redirect the LIVE policy.
  const fixture = path.join(root, 'autonomy-policy.json');
  fs.writeFileSync(fixture, JSON.stringify({ version: 1, levels: { 'propose-source': 'L3', 'research-network': 'L1' } }), 'utf8');
  const state = policy.loadFrom(fixture);
  check('a data edit raises one of the four without any source change',
    policy.effectiveFrom(state, 'propose-source') === 'L3');
  check('and restricts another below its floor, which is master\'s authority intact',
    policy.effectiveFrom(state, 'research-network') === 'L1');
  const poisoned = policy.loadFrom(fixture.replace(/\.json$/, '-missing.json'));
  check('an absent fixture falls back to the floors rather than to nothing',
    policy.effectiveFrom(poisoned, 'propose-question') === 'L3');

  const forged = path.join(root, 'forged.json');
  fs.writeFileSync(forged, JSON.stringify({ version: 1, levels: { 'master-record': 'L4' } }), 'utf8');
  const forgedState = policy.loadFrom(forged);
  check('a file naming a permanent class is rejected whole, so every class falls to its floor',
    forgedState.rejected === true && policy.effectiveFrom(forgedState, 'propose-source') === policy.FLOORS['propose-source']);
  check('and what is recorded about master stays exactly at its floor',
    policy.effectiveFrom(forgedState, 'master-record') === policy.FLOORS['master-record']);
}

// 14. require() and the master-driven carve-out
console.log('\n  require() names what it needed; requireMasterDriven() is a two-class door');
{
  const root = scratch('require');
  stop.configure({ userDataRoot: root });
  policy.reload();
  let threw = false;
  try { policy.require('propose-source'); } catch { threw = true; }
  check('a gate with no explicit level THROWS rather than defaulting', threw === true);
  const refusal = policy.require('propose-source', 'L3', { action: 'filing a diff' });
  check('a refusal names the class, what it has, and what it needed',
    refusal?.blocked === true && refusal.classId === 'propose-source'
    && refusal.have === 'L0' && refusal.need === 'L3' && /L3/.test(refusal.reason), refusal?.reason);
  check('and it is shaped like capability.deny — null when allowed, the object when not',
    policy.require('observe', 'L0') === null);

  check('requireMasterDriven permits master\'s apply on a stopped install',
    policy.requireMasterDriven('revert-own-apply', 'L4') === null);
  check('and permits apply-source, the other MASTER_ACT class',
    policy.requireMasterDriven('apply-source', 'L4') === null);
  check('the MASTER_ACT subset is exactly two — a third member turns this RED, and only a source edit '
    + 'can add one now that the view has no add()',
    policy.MASTER_ACT.size === 2 && policy.MASTER_ACT.has('apply-source') && policy.MASTER_ACT.has('revert-own-apply')
    && typeof policy.MASTER_ACT.add === 'undefined',
    [...policy.MASTER_ACT].join(', '));
  for (const c of ['propose-source', 'observe', 'research-network', 'author-change', 'master-record']) {
    let t = false;
    try { policy.requireMasterDriven(c, 'L3'); } catch { t = true; }
    check(`requireMasterDriven THROWS for "${c}" — a Rāma class cannot borrow the carve-out`, t === true);
  }
  const polCode = read('electron/lib/autonomyPolicy.cjs').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  check('ignoreStop has exactly one consumer in the whole module',
    (polCode.match(/ignoreStop:\s*true/g) || []).length === 1);
  // Bounded by the NEXT function declaration rather than by a character count, so growing the body of
  // requireMasterDriven cannot turn this row red while the claim it makes is still true.
  const mdStart = polCode.indexOf('function requireMasterDriven');
  const mdNext = polCode.indexOf('\nfunction ', mdStart + 1);
  const mdBody = polCode.slice(mdStart, mdNext === -1 ? undefined : mdNext);
  check('and that consumer is requireMasterDriven',
    mdStart !== -1 && /ignoreStop:\s*true/.test(mdBody));
  const libDir = path.join(ROOT, 'electron', 'lib');
  const borrowers = fs.readdirSync(libDir).filter((f) => {
    if (!f.endsWith('.cjs') || f === 'autonomyPolicy.cjs') return false;
    return /ignoreStop/.test(read(path.join('electron', 'lib', f)).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ''));
  });
  check('no other module passes ignoreStop at all', borrowers.length === 0, borrowers.join(', '));
}

// 15. the policy's own authority is not nameable by a diff
console.log('\n  the policy\'s own authority');
check('four self-governing paths are declared, in the policy module rather than in a consumer',
  policy.SELF_GOVERNING_PATHS.length === 4 && Object.isFrozen(policy.SELF_GOVERNING_PATHS));
check('the data file is marked optional, because it ships absent',
  policy.SELF_GOVERNING_PATHS.find(p => p.path.endsWith('autonomy-policy.json')).optional === true);
for (const entry of policy.SELF_GOVERNING_PATHS) {
  if (entry.optional) continue;
  check(`${entry.path} exists on disk`, fs.existsSync(path.join(ROOT, entry.path)));
}
const guard = require('../electron/lib/loyaltyGuard.cjs');
const unprotected = policy.SELF_GOVERNING_PATHS
  .map(e => e.path)
  .filter(p => !guard.PROTECTED_FILES.includes(p));
if (unprotected.length) {
  residual(`not in loyaltyGuard.PROTECTED_FILES: ${unprotected.join(', ')} — loyaltyGuard.cjs is itself `
    + 'protected, so only master can add them. Until he does, the create gate and the applier\'s entry '
    + 'validation are the only mechanical guards on them. See docs/research/self-upgrade-build.md.');
}
check('the tripwire manifest is one of the self-governing paths',
  policy.SELF_GOVERNING_PATHS.some(p => p.path === 'shared/loyalty-tripwire.json'));

// 16. MASTER'S OWN ACT IS NOT GOVERNABLE BY A FILE
// The defect this section exists to catch: with `revert-own-apply` merely EDITABLE, a validated,
// documented data edit lowering it to L0 made the applier's entry gate refuse A MASTER-APPROVED APPLY
// again — the same defect the first rows of verifyUpgradeApplier.cjs exist to catch, reached through a
// different door. Both MASTER_ACT classes are PERMANENT now, and the two sets cannot drift apart
// quietly because requireMasterDriven refuses to resolve a MASTER_ACT class that is not permanent.
console.log('\n  master\'s own act cannot be governed by a data edit');
check('every MASTER_ACT class is also PERMANENT — this is the structural half of the fence',
  [...policy.MASTER_ACT].every(c => policy.PERMANENT.has(c)),
  [...policy.MASTER_ACT].filter(c => !policy.PERMANENT.has(c)).join(', '));
check('revert-own-apply is one of them, so the data file is not read for it at all',
  policy.PERMANENT.has('revert-own-apply') && policy.MASTER_ACT.has('revert-own-apply'));
check('a data file lowering revert-own-apply to L0 is rejected WHOLE rather than accepted',
  policy.validate({ version: 1, levels: { 'revert-own-apply': 'L0' } }).ok === false);
check('and so is one that only lowers it alongside legitimate edits',
  policy.validate({ version: 1, levels: { 'research-network': 'L1', 'revert-own-apply': 'L0' } }).ok === false);
{
  // EXECUTED, not matched. This row used to test two regexes against requireMasterDriven's own source
  // text, which passes for any function that merely mentions the identifier — the one row in this area
  // that asserted a shape instead of a behaviour, guarding the loud half of the fence. The sets are
  // genuinely immutable now, so the divergence cannot be produced by deleting a member; the fence is a
  // pure function over the two sets instead, and the suite hands it a pair that disagrees.
  const divergent = { permanent: policy.frozenSetView(['apply-source']) };
  const err = policy.masterDrivenFence('revert-own-apply', divergent);
  check('the fence REFUSES a MASTER_ACT class that is not PERMANENT, with the reason in the message',
    err instanceof Error
    && /is a MASTER_ACT class but not a PERMANENT one/.test(err.message)
    && /refuse master's own act/.test(err.message), err && err.message);
  check('and it still refuses a class that is not MASTER_ACT at all, even with that pair',
    /only for MASTER_ACT classes/.test(policy.masterDrivenFence('propose-source', divergent)?.message || ''));
  check('with the real sets it permits both members and returns null',
    policy.masterDrivenFence('apply-source') === null
    && policy.masterDrivenFence('revert-own-apply') === null);
  const polCode = read('electron/lib/autonomyPolicy.cjs').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  check('and the production door passes NO override — the seam is the suite\'s, not a caller\'s',
    /const fenced = masterDrivenFence\(classId\);/.test(polCode)
    && (polCode.match(/masterDrivenFence\(/g) || []).length === 2);
  const libDir = path.join(ROOT, 'electron', 'lib');
  const overriders = fs.readdirSync(libDir).filter((f) => {
    if (!f.endsWith('.cjs') || f === 'autonomyPolicy.cjs') return false;
    return /masterDrivenFence/.test(read(path.join('electron', 'lib', f)).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ''));
  });
  check('no other module calls the fence directly', overriders.length === 0, overriders.join(', '));
}
{
  // And the behavioural end of it, through the LIVE loader rather than a fixture: a real data file on
  // disk at policy.DATA_FILE, which §4 of the build note had to concede was a path the suite never took.
  const root = scratch('livefile');
  writeAllow(root, { allowed: true, by: 'master', at: 'now', note: 'allowed' });
  stop.configure({ userDataRoot: root });
  if (fs.existsSync(policy.DATA_FILE)) {
    residual(`${policy.DATA_FILE} already exists, so the live-loader rows were SKIPPED rather than `
      + 'overwrite master\'s own policy file. Move it aside and re-run to exercise them.');
  } else {
    try {
      policy.reload();
      check('with no data file, propose-question is permitted at its L3 floor',
        policy.require('propose-question', 'L3') === null);
      fs.writeFileSync(policy.DATA_FILE,
        JSON.stringify({ version: 1, levels: { 'propose-question': 'L1' } }, null, 2), 'utf8');
      check('a hand-written restriction takes effect at the next gate with NO reload call and NO restart',
        policy.require('propose-question', 'L3')?.blocked === true);
      check('and the loader reports the file as the source, so the live present-file branch really ran',
        policy.policyStatus().source === 'file');
      check('master\'s own apply is STILL permitted while that file is in place',
        policy.requireMasterDriven('revert-own-apply', 'L4') === null
        && policy.requireMasterDriven('apply-source', 'L4') === null);

      fs.writeFileSync(policy.DATA_FILE,
        JSON.stringify({ version: 1, levels: { 'revert-own-apply': 'L0' } }, null, 2), 'utf8');
      check('a real file lowering revert-own-apply is rejected whole by the live loader',
        policy.policyStatus().rejected === true && /revert-own-apply/.test(policy.policyStatus().why || ''));
      check('AND MASTER\'S APPROVED APPLY IS STILL PERMITTED — the second door is shut',
        policy.requireMasterDriven('revert-own-apply', 'L4') === null);

      fs.unlinkSync(policy.DATA_FILE);
      check('deleting the file restores the floors live, without a restart',
        policy.require('propose-question', 'L3') === null && policy.policyStatus().source === 'absent');
    } finally {
      try { fs.unlinkSync(policy.DATA_FILE); } catch { /* already gone, which is the shipped state */ }
      policy.reload();
    }
    check('and the data file is absent again, exactly as it ships',
      fs.existsSync(policy.DATA_FILE) === false);
  }
}

// 17. lift()'s SUCCESS path, executed rather than read
// It is the only writer of `allowed: true` — the single act that enables autonomy — and with the real
// capability module it cannot succeed for anyone, so every one of these facts used to be asserted by
// regex over the function's own source text. The injected module is not a weakening: isStopped() reads
// a plain unsigned JSON file, so anything that could pass a fake here could already write the allow-file
// directly. What holds that line is the asserted absence of callers, below.
console.log('\n  lift() — the success path, with the capability module injected');
{
  const root = scratch('liftreal');
  stop.configure({ userDataRoot: root });
  const granting = { deny: () => null, can: () => true };
  const master = { name: 'master', tier: 0 };

  check('the install starts stopped', stop.isStopped() === true);
  stop.engage('something went wrong', 'verifyAutonomyStop');
  check('and halted, with a record on disk', stop.isHalted() === true);

  check('an empty note is refused even when the capability is granted',
    stop.lift(master, '   ', { capability: granting }).ok === false);
  check('and it is refused for being a note, not for being a capability',
    /requires a note/.test(stop.lift(master, '', { capability: granting }).error));
  check('a string user is refused before the injected module is ever consulted',
    stop.lift('master', 'because', { capability: granting }).ok === false);
  check('and so is a user with no numeric tier',
    stop.lift({ name: 'x' }, 'because', { capability: granting }).ok === false);
  check('autonomy is still stopped after all four refusals', stop.isStopped() === true);

  const lifted = stop.lift(master, 'master allowed it, for this reason', { capability: granting });
  check('with the capability granted and a note, lift() SUCCEEDS', lifted.ok === true, lifted.error);
  check('it wrote a valid allow-file to the derived path',
    JSON.parse(fs.readFileSync(stop.allowPath(), 'utf8')).allowed === true);
  check('the file records WHO and WHY, not just that it happened',
    lifted.allow.by === 'master (tier 0)' && lifted.allow.note === 'master allowed it, for this reason');
  check('and the note on disk matches the one returned',
    JSON.parse(fs.readFileSync(stop.allowPath(), 'utf8')).note === 'master allowed it, for this reason');
  check('isStopped() now reports autonomy as allowed', stop.isStopped() === false);
  check('the halt was cleared rather than left undoable',
    lifted.haltCleared === true && stop.isHalted() === false
    && fs.existsSync(stop.stoppedRecordPath()) === false);
  check('and statusText() says allowed, by whom, instead of still saying stopped',
    /loop is allowed \(master \(tier 0\)/.test(stop.statusText()), stop.statusText());

  check('a denying capability module still refuses, so the seam does not bypass the check',
    stop.lift(master, 'again', { capability: { deny: () => ({ error: 'nope' }), can: () => false } }).ok === false);

  const dirs = [['electron', 'lib'], ['electron', 'ipc'], ['electron']];
  const overriders = [];
  for (const parts of dirs) {
    let names = [];
    try { names = fs.readdirSync(path.join(ROOT, ...parts)).filter(f => f.endsWith('.cjs')); } catch { names = []; }
    for (const name of names) {
      if (name === 'autonomyStop.cjs') continue;
      const src = read(path.join(...parts, name)).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      if (/\.lift\s*\([^)]*capability/.test(src)) overriders.push(path.join(...parts, name));
    }
  }
  check('no module in the shipped tree passes a capability override to lift()',
    overriders.length === 0, overriders.join(', '));
  check('the seam is a parameter with a default, so the production path is the real module',
    /function lift\(user, note, \{ capability: injectedCapability = null \} = \{\}\)/.test(stopSrc)
    && /if \(!capability\) \{/.test(stopCode));
}

// 18. a degraded create fence is visible where autonomy is reported
// The stop is fail-safe; the create fence is fail-open by design, so that a gate that cannot load never
// costs the ledger its channels (I11). safeRequire records that in the BOOT LOG, which is not the
// autonomy surface — so status() and statusText() would have gone on describing a fence that was not
// in place.
console.log('\n  the create fence reports its own absence');
{
  const root = scratch('fence');
  stop.configure({ userDataRoot: root });
  const fence = stop.status().createFence;
  check('status() reports the create fence as its own field, with the module named',
    fence.module === 'electron/lib/autonomyGate.cjs' && typeof fence.loaded === 'boolean');
  check('and declares that it is fail-open, rather than leaving that to be inferred',
    fence.failOpen === true && typeof fence.governs === 'string');
  check('on this machine the gate loads, so the fence IS in place',
    fence.loaded === true && stop.gateLoaded() === true);
  check('and statusText() says so', /create fence on proposals:create is in place/.test(stop.statusText()));

  // The degraded branch, EXECUTED: a cached module that is not the fence. This is the shape a partial
  // or shadowed load leaves behind, and it is the state the warning exists for.
  const gatePath = require.resolve('../electron/lib/autonomyGate.cjs');
  const realExports = require.cache[gatePath].exports;
  require.cache[gatePath].exports = {};
  try {
    check('a module that loaded but is not the fence reports NOT LOADED',
      stop.gateLoaded() === false && stop.status().createFence.loaded === false);
    const degraded = stop.statusText();
    check('and statusText() warns that every create is reaching the ledger unvalidated',
      /NOT IN PLACE/.test(degraded) && /unvalidated/.test(degraded), degraded);
    check('and names both fences that are missing, so the degradation is specific',
      /kind fence/.test(degraded) && /path fence/.test(degraded));
    check('and still says what the loop itself is doing — the two facts stay separate',
      /loop is stopped/.test(degraded));
  } finally {
    require.cache[gatePath].exports = realExports;
  }
  check('the fence reports as in place again once the real module is back', stop.gateLoaded() === true);
}

}

// done
provePreExistingStillDispatches()
  .then(rest)
  .then(() => {
    stop.configure({ userDataRoot: null });
    if (savedEnv === undefined) delete process.env[stop.ENV_KEY];
    else process.env[stop.ENV_KEY] = savedEnv;

    if (residuals.length) {
      console.log(`\n  ${residuals.length} residual(s) printed above — held by hand, not by this suite`);
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
