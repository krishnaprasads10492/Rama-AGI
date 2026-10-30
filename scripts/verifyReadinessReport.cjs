'use strict';
/**
 * verifyReadinessReport.cjs - the readiness report says what master has to do (spec Section 162)
 *
 * Driven by three real transcripts shipped from the build machine, where the ONLY blocking item was
 * free disk and the report managed to say so without ever naming how much was needed. The verdict is
 * not just screen output: it is saved to `data/system/readiness.json` and embedded in the shipped
 * build manifest, so a reason it drops is a reason nobody can recover later.
 *
 *   SAY THE NUMBER       a refusal names the floor, the shortfall and the comfortable mark
 *   CARRY THE REASON     the verdict holds WHY, not "see the report above"
 *   NO FALSE TICK        the table cannot show dependencies as fine while packages are missing
 *
 * Pure: `diskVerdict` and `computeReadiness` are exported, so nothing is built, probed or installed.
 *
 * Run: node scripts/verifyReadinessReport.cjs   (or npm run verify:readiness)
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
let pass = 0;
let fail = 0;
function check(label, ok, detail) {
  if (ok) { pass += 1; console.warn(`  PASS  ${label}`); } else { fail += 1; console.warn(`  FAIL  ${label}${detail ? ` - ${detail}` : ''}`); }
}
const section = (t) => console.warn(`\n--- ${t} ---`);
let finished = false;
process.on('exit', () => { if (!finished) { console.warn('  FAIL  the suite did not reach its summary (something never settled)'); process.exitCode = 1; } });

const b = require(path.join(ROOT, 'scripts/buildInstaller.cjs'));
const FLOOR = b.DISK_FLOOR_MB;
const COMFY = b.DISK_COMFY_MB;

(async () => {
  console.warn('\nreadiness report - it says what master has to do\n');

  // ═══ the disk verdict ══════════════════════════════════════════════════════════════════════════
  section('diskVerdict: the numbers are in the sentence');
  check('the floor and the comfortable mark are the documented ones', FLOOR === 1200 && COMFY === 3000, `${FLOOR}/${COMFY}`);
  const fails = b.diskVerdict(636);
  check('the real figure from the shipped log fails', fails.state === 'fail');
  check('and the message names the free space, the floor and the shortfall', /636 MB free/.test(fails.message) && new RegExp(`at least ${FLOOR} MB`).test(fails.message) && /564 MB more/.test(fails.message));
  check('and the comfortable mark, so master can free enough the first time', new RegExp(`${COMFY} MB`).test(fails.message));
  check('the shortfall is returned as a number too', fails.shortBy === FLOOR - 636);
  check('it no longer says only that packaging "needs the unpacked tree plus the installer"', !/^Only 636 MB free\. Packaging Electron needs the unpacked tree plus the installer\.$/.test(fails.message));

  section('diskVerdict: the boundaries');
  check(`one MB under the floor fails`, b.diskVerdict(FLOOR - 1).state === 'fail' && b.diskVerdict(FLOOR - 1).shortBy === 1);
  check('exactly the floor is no longer a refusal', b.diskVerdict(FLOOR).state === 'tight');
  check('one under the comfortable mark is still tight', b.diskVerdict(COMFY - 1).state === 'tight');
  check('exactly the comfortable mark is fine', b.diskVerdict(COMFY).state === 'ok');
  check('well above is fine, and says the figure', b.diskVerdict(91170).state === 'ok' && /91170 MB free/.test(b.diskVerdict(91170).message));
  check('a tight verdict explains itself rather than just saying "tight"', new RegExp(`${FLOOR} MB floor`).test(b.diskVerdict(2000).message) && /may fail late/.test(b.diskVerdict(2000).message));
  check('zero free fails, and the shortfall is the whole floor', b.diskVerdict(0).state === 'fail' && b.diskVerdict(0).shortBy === FLOOR);
  for (const [n, v] of [['null', null], ['undefined', undefined], ['NaN', NaN], ['a string', '636'], ['Infinity', Infinity]]) {
    const r = b.diskVerdict(v);
    check(`${n} is "unknown", and never a refusal`, r.state === 'unknown' && /could not be measured/.test(r.message));
  }
  check('every state carries a non-empty message', [null, 0, FLOOR, COMFY].every((v) => typeof b.diskVerdict(v).message === 'string' && b.diskVerdict(v).message.length > 10));

  // ═══ the verdict ═══════════════════════════════════════════════════════════════════════════════
  section('computeReadiness: the reason is carried, not pointed at');
  const base = {
    deps: { ok: true, degraded: [], pendingInstall: 0 },
    archiver: { level: 0, version: '21.07' },
    link: { ok: true },
    nsisNotes: [],
    rendererPresent: true,
  };
  const R = (o) => b.computeReadiness({ toolchain: { ok: true, reasons: [] }, ...base, ...o });

  const reason = 'Only 636 MB free. Packaging needs at least 1200 MB — free about 564 MB more.';
  const blocked = R({ toolchain: { ok: false, reasons: [reason] } });
  check('a blocked toolchain makes it not-ready', blocked.verdict === 'not-ready' && blocked.predicted === 'nothing — the build cannot complete');
  check('AND THE BLOCKING LINE IS THE REASON ITSELF', blocked.blocking.includes(reason), JSON.stringify(blocked.blocking));
  check('not a pointer to scrollback', !blocked.blocking.some((x) => /see the stage 0 report above/.test(x)));
  check('several reasons all survive', (() => {
    const r = R({ toolchain: { ok: false, reasons: ['first thing', 'second thing'] } });
    return r.blocking.includes('first thing') && r.blocking.includes('second thing');
  })());
  check('with no reasons given it falls back to the old pointer rather than saying nothing', (() => {
    const r = R({ toolchain: { ok: false, reasons: [] } });
    return r.blocking.length === 1 && /see the stage 0 report above/.test(r.blocking[0]);
  })());
  check('empty and junk reasons are dropped, not printed', (() => {
    const r = R({ toolchain: { ok: false, reasons: ['', null, 'real one'] } });
    return r.blocking.length === 1 && r.blocking[0] === 'real one';
  })());
  check('a bare true still means a healthy toolchain (nothing else had to change)', R({ toolchain: true }).checks.toolchain === true && R({ toolchain: true }).verdict === 'ready');
  check('a bare false is still blocking', R({ toolchain: false }).verdict === 'not-ready');
  check('the saved record carries the blocking list, so a reader later has the reason', Array.isArray(blocked.blocking) && blocked.blocking.length > 0 && typeof blocked.at === 'string');

  section('computeReadiness: no false tick for dependencies');
  const pending = R({ deps: { ok: true, degraded: [], pendingInstall: 21 } });
  check('the number of packages a build must install is reported', pending.checks.dependenciesPending === 21);
  check('and the boolean stays a boolean, because the manifest is read elsewhere', pending.checks.dependencies === true && typeof pending.checks.dependencies === 'boolean');
  check('nothing pending reads as zero, not as absent', R({}).checks.dependenciesPending === 0);
  check('a missing or odd count is zero rather than undefined', b.computeReadiness({ toolchain: true, ...base, deps: { ok: true, degraded: [] } }).checks.dependenciesPending === 0
    && b.computeReadiness({ toolchain: true, ...base, deps: { ok: true, degraded: [], pendingInstall: 'lots' } }).checks.dependenciesPending === 0);
  check('pending packages alone do not block or downgrade the verdict (a build installs them)', pending.verdict === 'ready');

  section('computeReadiness: the rest of the verdict still holds');
  check('no usable archiver is a limit, not a block', (() => {
    const r = R({ archiver: { level: 2 } });
    return r.verdict === 'ready-with-limits' && r.predicted === 'portable zip only (no installer)' && r.limits.some((l) => /No usable 7-Zip/.test(l));
  })());
  check('no symlink privilege costs the branding', (() => {
    const r = R({ link: { ok: false } });
    return r.predicted === 'NSIS installer + portable exe, unbranded .exe' && r.limits.some((l) => /default icon/.test(l));
  })());
  check('a degraded capability is reported as a limit', R({ deps: { ok: true, degraded: ['node-pty unavailable (fallback active)'], pendingInstall: 0 } }).limits.some((l) => /node-pty/.test(l)));
  check('dependencies that could not be installed DO block', R({ deps: { ok: false, degraded: [] } }).verdict === 'not-ready');
  check('all clear is ready and fully branded', R({}).verdict === 'ready' && R({}).predicted === 'NSIS installer + portable exe, fully branded');

  // ═══ the log that prompted this ════════════════════════════════════════════════════════════════
  section('the build machine, replayed from its shipped transcript');
  // Exactly what build-2026-10-20T17-26-11-845Z.log reported: disk the only blocker, 21 packages
  // pending, 7-Zip L0 usable, symlink privilege present, renderer present, node-pty degraded.
  const machine = b.computeReadiness({
    toolchain: { ok: false, reasons: [b.diskVerdict(636).message] },
    deps: { ok: true, degraded: ['node-pty unavailable (fallback active)'], pendingInstall: 21 },
    archiver: { level: 0, version: '21.07' },
    link: { ok: true },
    nsisNotes: [],
    rendererPresent: true,
  });
  check('it is still not-ready, for the one real reason', machine.verdict === 'not-ready' && machine.blocking.length === 1);
  check('and that reason now tells master to free about 564 MB', /564 MB more/.test(machine.blocking[0]));
  check('the table no longer hides 21 pending packages behind a tick', machine.checks.dependenciesPending === 21);
  check('what is GOOD on that machine is still reported as good', machine.checks.symlinkPrivilege === true && machine.checks.archiverLevel === 0 && machine.checks.rendererPresent === true);
  check('and the one degradation is still a limit', machine.limits.some((l) => /node-pty/.test(l)));

  // ═══ the Node floor (Section 163) ══════════════════════════════════════════════════════════════
  section('nodeFloorVerdict: the wrong Node is caught at stage 0, not forty seconds later');
  const FLOOR_DECL = '>=22.23.4';
  const tooOld = b.nodeFloorVerdict('20.10.0', FLOOR_DECL);
  check('the build machine\'s Node is refused', tooOld.ok === false);
  check('and the message names the version it has and the one it needs', tooOld.message.includes('20.10.0') && tooOld.message.includes('22.23.4'));
  check('and names the failure it prevents, so it is recognisable in an old log', /ERR_REQUIRE_ESM/.test(tooOld.message) && tooOld.message.includes('@noble/hashes'));
  check('and says what to install, by version rather than by label', /22\.23\.4/.test(tooOld.message) && /Install it and run this again/.test(tooOld.message));
  check('exactly the floor passes', b.nodeFloorVerdict('22.23.4', FLOOR_DECL).ok === true);
  check('one patch under the floor is refused', b.nodeFloorVerdict('22.23.3', FLOOR_DECL).ok === false);
  check('a later line passes', b.nodeFloorVerdict('22.23.4', FLOOR_DECL).ok === true && b.nodeFloorVerdict('24.22.1', FLOOR_DECL).ok === true);
  check('the 20 line is refused however new, and it is end-of-life besides', b.nodeFloorVerdict('20.19.5', FLOOR_DECL).ok === false);
  check('a passing verdict carries no message to print', b.nodeFloorVerdict('22.23.4', FLOOR_DECL).message === null);
  check('the floor is echoed back for the caller', b.nodeFloorVerdict('22.23.4', FLOOR_DECL).floor === FLOOR_DECL);
  for (const [n, v] of [['no declaration', null], ['empty', ''], ['a caret range', '^22.12.0'], ['nonsense', 'latest'], ['an object', {}]]) {
    check(`a floor that cannot be read (${n}) never blocks a build`, b.nodeFloorVerdict('18.0.0', v).ok === true);
  }
  for (const [n, v] of [['undefined', undefined], ['nonsense', 'v-next'], ['empty', '']]) {
    check(`an unreadable current version (${n}) never blocks either`, b.nodeFloorVerdict(v, FLOOR_DECL).ok === true);
  }

  section('the declared floor is the real one');
  const engines = (() => { try { return (JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).engines || {}).node || null; } catch { return null; } })();
  check('package.json declares a Node floor at all', typeof engines === 'string' && /^>=[0-9]+\.[0-9]+\.[0-9]+$/.test(engines), String(engines));
  check('and it is the patched 22.23.4 the October 2026 security release shipped', engines === '>=22.23.4', String(engines));
  check('the floor that was declared before the security release is now refused', b.nodeFloorVerdict('22.12.0', engines).ok === false);
  check('the refusal says the floor is a SECURITY floor, not only a compatibility one', (() => {
    const m = b.nodeFloorVerdict('22.12.0', engines).message;
    return /SECURITY floor/.test(m) && m.includes('CVE-2026-111497') && /eMudhra/.test(m);
  })());
  check('the pinned electron is at or above the version that mitigates the compromised CA', (() => {
    const p = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const v = (p.devDependencies || {}).electron || (p.dependencies || {}).electron || '';
    const n = (x) => { const m = /(\d+)\.(\d+)\.(\d+)/.exec(String(x)); return m ? Number(m[1]) * 1e6 + Number(m[2]) * 1e3 + Number(m[3]) : 0; };
    return n(v) >= n('44.10.0');
  })());
  check('the pinned systeminformation is at or above the Windows command-injection fix', (() => {
    const p = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const v = (p.dependencies || {}).systeminformation || (p.devDependencies || {}).systeminformation || '';
    const n = (x) => { const m = /(\d+)\.(\d+)\.(\d+)/.exec(String(x)); return m ? Number(m[1]) * 1e6 + Number(m[2]) * 1e3 + Number(m[3]) : 0; };
    return n(v) >= n('5.33.19');
  })());
  check('every version in package.json is still exact, with no range (I12)', (() => {
    const p = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const all = { ...(p.dependencies || {}), ...(p.devDependencies || {}) };
    return Object.values(all).every((v) => /^[0-9]+\.[0-9]+\.[0-9]+/.test(String(v)));
  })());
  check('and it is not below what the pinned electron itself requires', (() => {
    let ebEngine = null;
    try { ebEngine = (JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules/electron/package.json'), 'utf8')).engines || {}).node || null; } catch { return true; }
    if (!ebEngine) return true;
    const num = (x) => { const m = /([0-9]+)\.([0-9]+)\.([0-9]+)/.exec(String(x)); return m ? Number(m[1]) * 1e6 + Number(m[2]) * 1e3 + Number(m[3]) : 0; };
    return num(engines) >= num(ebEngine);
  })(), 'electron asks for more than package.json declares');

  section('the archiver: absent is not unusable');
  const notBundled = b.computeReadiness({ toolchain: true, ...base, archiver: { level: 3, version: null } });
  check('level 3 does not make the installer unreachable', notBundled.verdict === 'ready' && !notBundled.limits.some((l) => /7-Zip/.test(l)));
  check('and an installer is still what it predicts', /NSIS installer/.test(notBundled.predicted));
  check('level 2 still means a zip only', /portable zip only/.test(b.computeReadiness({ toolchain: true, ...base, archiver: { level: 2 } }).predicted));
  check('the level is recorded for the manifest', notBundled.checks.archiverLevel === 3);

  // ═══ stage 0 reports everything, once (Section 164) ═══════════════════════════════════════════
  section('toolchainVerdict: no refusal hides the measurement after it');
  const facts = {
    nodeVersion: '22.23.4', floor: '>=22.23.4', npmOk: true,
    projectName: 'rama-agi', projectError: null, root: 'C:/repo',
    disk: { state: 'ok', message: 'Disk space 102101 MB free' },
  };
  const T = (o) => b.toolchainVerdict({ ...facts, ...o });
  check('a healthy machine has nothing to report', T({}).ok === true && T({}).reasons.length === 0 && T({}).nodeOk === true);

  check('a Node below the project floor is a reason', (() => {
    const r = T({ nodeVersion: '20.10.0' });
    return r.ok === false && r.reasons.length === 1 && /below the 22\.23\.4/.test(r.reasons[0]) && r.nodeOk === false;
  })());
  check('a Node below the hard v18 minimum is its own reason, not the floor message', (() => {
    const r = T({ nodeVersion: '16.20.0' });
    return r.reasons.length === 1 && /v18 minimum/.test(r.reasons[0]) && !/ERR_REQUIRE_ESM/.test(r.reasons[0]);
  })());
  check('missing npm is a reason', (() => {
    const r = T({ npmOk: false });
    return r.ok === false && r.reasons.some((x) => /npm is not on PATH/.test(x));
  })());
  check('an unreadable package.json is a reason, with the path and the cause', (() => {
    const r = T({ projectError: 'EACCES', projectName: null });
    return r.reasons.some((x) => x.includes('C:/repo') && x.includes('EACCES'));
  })());
  check('the wrong project is a reason, and names what it found', (() => {
    const r = T({ projectName: 'someone-elses-app' });
    return r.reasons.some((x) => /not the Rāma project root/.test(x) && x.includes('someone-elses-app'));
  })());
  check('an unreadable package.json does not ALSO complain about the name', T({ projectError: 'EACCES', projectName: null }).reasons.length === 1);
  check('a failing disk is a reason, and it is the disk message itself', (() => {
    const d = b.diskVerdict(636);
    const r = T({ disk: d });
    return r.reasons.includes(d.message);
  })());

  check('FOUR PROBLEMS AT ONCE ARE ALL REPORTED, in one run', (() => {
    const r = T({ nodeVersion: '20.10.0', npmOk: false, projectName: 'wrong', disk: b.diskVerdict(100) });
    return r.ok === false && r.reasons.length === 4;
  })());
  check('and in a stable order: Node, npm, project, disk', (() => {
    const r = T({ nodeVersion: '20.10.0', npmOk: false, projectName: 'wrong', disk: b.diskVerdict(100) });
    return /^Node\.js /.test(r.reasons[0]) && /^npm is not/.test(r.reasons[1]) && /project root/.test(r.reasons[2]) && /MB free/.test(r.reasons[3]);
  })());

  check('tight, unknown and ok disk states are never reasons', ['tight', 'unknown', 'ok'].every((state) => T({ disk: { state, message: 'x' } }).reasons.length === 0));
  check('a missing disk fact does not throw', (() => { try { return T({ disk: null }).ok === true; } catch { return false; } })());
  check('nodeOk is about Node only: npm and disk problems leave it true', T({ npmOk: false, disk: b.diskVerdict(100) }).nodeOk === true);
  check('an unreadable Node version is refused rather than waved through', T({ nodeVersion: 'v-next' }).ok === false);

  // ═══ source rules ══════════════════════════════════════════════════════════════════════════════
  section('what must not drift');
  const src = fs.readFileSync(path.join(ROOT, 'scripts/buildInstaller.cjs'), 'utf8');
  check('the thresholds are declared once, not inline', /const DISK_FLOOR_MB = 1200;/.test(src) && /const DISK_COMFY_MB = 3000;/.test(src) && !/disk < 1200/.test(src) && !/disk < 3000/.test(src));
  check('the toolchain check returns one verdict, reasons and all', src.includes('return { ok: verdict.ok, reasons: verdict.reasons };'));
  check('what is printed and what is returned are the same list', src.includes('for (const r of verdict.reasons) fail(r);') && !src.includes('reasons.push(m)'));
  // Found by mutation: the verdict checks above all pass a hand-made toolchain object, so they never
  // notice if checkToolchain itself stops RECORDING a refusal. The disk case is the one that matters,
  // because it is the only blocking item the build machine has ever reported.
  const body = (() => {
    const i = src.indexOf('function checkToolchain()');
    const j = src.indexOf('\n}', i);
    return i < 0 || j < 0 ? '' : src.slice(i, j);
  })();
  check('the disk measurement reaches the verdict rather than being printed and dropped', body.includes('disk,') && body.includes('const disk = diskVerdict(freeDiskMB());'), body.length ? 'checked' : 'function body not found');
  check('and there is no way out of it that skips the verdict', body.length > 0 && (body.match(/return /g) || []).length === 1);
  check('the call sites use the object', /const toolchain = checkToolchain\(\);/.test(src) && /if \(!toolchain\.ok && !readinessOnly\) return 1;/.test(src) && !/toolchainOk, deps, archiver/.test(src));
  check('the pending count comes from the value readiness already computed', /pendingInstall: audit\.required\.length/.test(src) && /Number\.isFinite\(deps\?\.pendingInstall\)/.test(src));
  check('requiring this script still does not run a build', /if \(require\.main === module\) runCli\(\)/.test(src));
  check('the Node floor is read from the declaration, not copied into the check', src.includes('(pkg().engines || {}).node'));
  // Found by mutation: asserting that `refuse(floor.message)` EXISTS passes even when the branch
  // around it has been turned off, so the gate itself is asserted as well as its body.
  check('the floor is applied inside the verdict, where it cannot be bypassed', src.includes('const floor = nodeFloorVerdict(f.nodeVersion, f.floor);') && src.includes('if (!floor.ok) reasons.push(floor.message);'));
  check('the app launcher is deliberately NOT gated on it', !fs.readFileSync(path.join(ROOT, 'start.cjs'), 'utf8').includes('engines'));
  check('an absent 7zip-bin is its own state, and that branch is reachable', (() => {
    const gate = src.indexOf('if (!toolchainBundles7za()) {');
    const probe = src.indexOf('const bundled = bundled7zaPath();');
    return src.includes('function toolchainBundles7za()') && gate >= 0 && probe >= 0 && gate < probe;
  })());
  check('and the bundled test is a plain existence check, not an inverted one',
    src.includes("return fs.existsSync(path.join(ROOT, 'node_modules', '7zip-bin'));"));
  check('and it returns level 3 rather than the level-2 dead end', src.includes('return { level: 3, version: null'));
  check('the report can name rung 3', src.includes("3: 'not bundled by this electron-builder"));
  check('usability is still "anything but level 2"', src.includes('archiver.level !== 2'));
  check('stage 0 judges once, from gathered facts, with no early return', (() => {
    const i = src.indexOf('function checkToolchain()');
    const j = src.indexOf('\n}', i);
    const body = i < 0 || j < 0 ? '' : src.slice(i, j);
    return body.includes('const verdict = toolchainVerdict({') && !body.includes('return { ok: false, reasons };');
  })());
  check('the facts are gathered before anything is judged', src.indexOf('const disk = diskVerdict(freeDiskMB());') < src.indexOf('const verdict = toolchainVerdict({'));
  check('the Node tick is conditional, so it cannot contradict its own refusal', src.includes('if (verdict.nodeOk) ok(`Node.js ${process.versions.node}`);'));
  check('the Vite note is held back when the version is already refused', src.includes('if (verdict.nodeOk && !modernLine) {'));
  check('every reason is printed as well as returned', src.includes('for (const r of verdict.reasons) fail(r);'));
  check('no console.log', !/console\.log/.test(src));

  finished = true;
  console.warn(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((err) => { console.warn('  FAIL  suite crashed: ' + err.stack); finished = true; process.exit(1); });
