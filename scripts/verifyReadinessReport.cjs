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

  // ═══ source rules ══════════════════════════════════════════════════════════════════════════════
  section('what must not drift');
  const src = fs.readFileSync(path.join(ROOT, 'scripts/buildInstaller.cjs'), 'utf8');
  check('the thresholds are declared once, not inline', /const DISK_FLOOR_MB = 1200;/.test(src) && /const DISK_COMFY_MB = 3000;/.test(src) && !/disk < 1200/.test(src) && !/disk < 3000/.test(src));
  check('the toolchain check returns its reasons', /return \{ ok: true, reasons \};/.test(src) && (src.match(/return \{ ok: false, reasons \};/g) || []).length >= 4);
  check('every toolchain refusal is recorded, not just printed', /const refuse = \(m\) => \{ fail\(m\); reasons\.push\(m\); \};/.test(src));
  // Found by mutation: the verdict checks above all pass a hand-made toolchain object, so they never
  // notice if checkToolchain itself stops RECORDING a refusal. The disk case is the one that matters,
  // because it is the only blocking item the build machine has ever reported.
  const body = (() => {
    const i = src.indexOf('function checkToolchain()');
    const j = src.indexOf('\n}', i);
    return i < 0 || j < 0 ? '' : src.slice(i, j);
  })();
  check('the disk refusal is recorded, not merely printed', /refuse\(d\.message\)/.test(body) && !/fail\(d\.message\)/.test(body), body.length ? 'checked' : 'function body not found');
  check('and every exit from the toolchain check records its reason first',
    body.length > 0 && (body.match(/refuse\(/g) || []).length >= (body.match(/return \{ ok: false/g) || []).length,
    `${(body.match(/refuse\(/g) || []).length} refuse vs ${(body.match(/return \{ ok: false/g) || []).length} refusals`);
  check('the call sites use the object', /const toolchain = checkToolchain\(\);/.test(src) && /if \(!toolchain\.ok && !readinessOnly\) return 1;/.test(src) && !/toolchainOk, deps, archiver/.test(src));
  check('the pending count comes from the value readiness already computed', /pendingInstall: audit\.required\.length/.test(src) && /Number\.isFinite\(deps\?\.pendingInstall\)/.test(src));
  check('requiring this script still does not run a build', /if \(require\.main === module\) runCli\(\)/.test(src));
  check('no console.log', !/console\.log/.test(src));

  finished = true;
  console.warn(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((err) => { console.warn('  FAIL  suite crashed: ' + err.stack); finished = true; process.exit(1); });
