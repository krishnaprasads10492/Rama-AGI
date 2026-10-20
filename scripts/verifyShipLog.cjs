'use strict';
/**
 * verifyShipLog.cjs - a failing build gets its log out, and never leaks the machine doing it (Section 161)
 *
 * Two halves, both behavioural:
 *
 *   WHEN IT SHIPS      `shouldShip` is driven directly. The bug this exists for: the condition was
 *                      `sawFailure`, which only `fail()` sets, so a NOT-READY readiness verdict exited 1
 *                      and its transcript - the one that says why the machine cannot build - stayed put.
 *   WHAT IT SHIPS      `redact` is driven directly, and the push-failure path is run END TO END in a
 *                      THROWAWAY repository whose `origin` does not exist, so the fallback is proven by
 *                      a real failed push rather than a stub. Master's own repository is never touched.
 *
 * Run: node scripts/verifyShipLog.cjs   (or npm run verify:ship-log)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
let pass = 0;
let fail = 0;
function check(label, ok, detail) {
  if (ok) { pass += 1; console.warn(`  PASS  ${label}`); } else { fail += 1; console.warn(`  FAIL  ${label}${detail ? ` - ${detail}` : ''}`); }
}
const section = (t) => console.warn(`\n--- ${t} ---`);
let finished = false;
const scratch = [];
process.on('exit', () => {
  for (const d of scratch) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
  if (!finished) { console.warn('  FAIL  the suite did not reach its summary (something never settled)'); process.exitCode = 1; }
});

// Requiring these must not run a build or ship anything - which is the point of their main guards.
const build = require(path.join(ROOT, 'scripts/buildInstaller.cjs'));
const ship = require(path.join(ROOT, 'scripts/shipLog.cjs'));

(async () => {
  console.warn('\nship-log - a failing build gets its log out, redacted\n');

  // ═══ when it ships ═════════════════════════════════════════════════════════════════════════════
  section('shouldShip');
  const S = (o) => build.shouldShip({ hadLog: true, sawFailure: false, code: 0, noShipLog: false, dryRun: false, ...o });
  check('a run that called fail() ships', S({ sawFailure: true, code: 1 }) === true);
  check('A NOT-READY VERDICT SHIPS, even though it never calls fail()', S({ code: 1 }) === true);
  check('any other non-zero exit ships', S({ code: 2 }) === true && S({ code: -1 }) === true);
  check('a clean run does not', S({}) === false);
  check('a clean exit that still reported a failure ships (the failure is the fact)', S({ sawFailure: true, code: 0 }) === true);
  check('--no-ship-log always wins', S({ sawFailure: true, code: 1, noShipLog: true }) === false);
  check('a dry run never ships, however badly it went', S({ sawFailure: true, code: 1, dryRun: true }) === false);
  check('with no transcript there is nothing to ship', S({ sawFailure: true, code: 1, hadLog: false }) === false);
  check('a truthy-but-not-true failure flag is not a failure on a clean exit', S({ sawFailure: 'yes', code: 0 }) === false);
  check('requiring the build script does not run a build', typeof build.shouldShip === 'function' && Object.keys(build).join() === 'shouldShip');

  // ═══ what it ships ═════════════════════════════════════════════════════════════════════════════
  section('redact: the machine never travels with the log');
  const user = os.userInfo().username;
  const host = os.hostname();
  const home = os.homedir();
  const sample = [
    `root     ${ROOT}`,
    `home     ${home}`,
    `user     ${user} on ${host}`,
    `path     C:\\Users\\${user}\\AppData\\Roaming\\rama-agi`,
    `unix     /home/${user}/.rama-agi`,
    `mac      /Users/${user}/Library`,
    `json     {"cwd":"${home.replace(/\\/g, '\\\\')}","who":"${user}"}`,
    'kept     Node.js 22.17.0 on win32-x64',
  ].join('\n');
  const red = ship.redact(sample);
  check('the home directory is gone, in plain form', !red.text.includes(home));
  check('and in JSON-escaped form', !red.text.includes(home.replace(/\\/g, '\\\\')));
  check('the username is gone everywhere it appeared', user.length > 2 ? !new RegExp(user, 'i').test(red.text) : true, red.text);
  check('the hostname is gone', host.length > 2 ? !new RegExp(host, 'i').test(red.text) : true);
  check('a Windows profile path keeps its shape but loses the name', /[A-Za-z]:\\Users\\<USER>/.test(red.text) || /<HOME>/.test(red.text));
  check('a unix and a mac profile path lose the name too', /\/home\/<USER>/.test(red.text) && /\/Users\/<USER>/.test(red.text));
  check('it reports how many rules fired', red.hits > 0 && typeof red.hits === 'number');

  // SOMEONE ELSE'S NAME, which the file says it covers: "including other machines' in pasted output".
  // Found by mutation: with only the current user's name in the sample, dropping the profile-path rules
  // changed nothing, because the username rule removed the name anyway. A foreign name is the only thing
  // that tells the two rules apart.
  const foreign = ship.redact([
    'win   C:\\Users\\someone-else\\AppData\\Roaming\\thing',
    'json  {"p":"C:\\\\Users\\\\someone-else\\\\AppData"}',
    'unix  /home/someone-else/.rama-agi',
    'mac   /Users/someone-else/Library',
  ].join('\n')).text;
  check('another person\'s Windows profile path is redacted, plain and JSON-escaped', !/someone-else/.test(foreign.split('unix')[0]), foreign);
  check('another person\'s unix and mac profile paths are redacted', /\/home\/<USER>/.test(foreign) && /\/Users\/<USER>/.test(foreign) && !/someone-else/.test(foreign), foreign);
  check('the path around the name is kept, so the log still reads', /AppData/.test(foreign) && /\.rama-agi/.test(foreign));
  check('what is NOT private is left alone', red.text.includes('Node.js 22.17.0 on win32-x64'));
  check('redacting twice changes nothing more', ship.redact(red.text).text === red.text);

  // A HOME THAT IS NOT UNDER C:\Users\ OR /home/. Found by mutation: dropping either home rule changed
  // nothing, because every sample path also matched the profile-path rule, which rewrites the segment
  // after `C:\Users\` and so hid the home as a side effect. A redirected or non-standard profile has
  // nothing else covering it, and that is the case the home rules exist for.
  const realProfile = process.env.USERPROFILE;
  const realHome = process.env.HOME;
  try {
    const odd = process.platform === 'win32' ? 'D:\\profiles\\rama-master' : '/opt/profiles/rama-master';
    process.env.USERPROFILE = odd;
    process.env.HOME = odd;
    const jsonOdd = odd.replace(/\\/g, '\\\\');
    const text = `plain ${odd}\njson {"cwd":"${jsonOdd}"}\nkept win32-x64\n`;
    const r2 = ship.redact(text);
    check('a home outside the usual profile folder is redacted, in plain form', !r2.text.includes(odd), r2.text);
    check('and in JSON-escaped form', !r2.text.includes(jsonOdd), r2.text);
    check('and the rest of the line survives', r2.text.includes('kept win32-x64'));
  } finally {
    if (realProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = realProfile;
    if (realHome === undefined) delete process.env.HOME; else process.env.HOME = realHome;
  }
  check('empty and odd input do not throw', ship.redact('').text === '' && typeof ship.redact('nothing to see').text === 'string');

  // ═══ the push cannot happen ════════════════════════════════════════════════════════════════════
  section('an unreachable remote is not a dead end (end to end, throwaway repository)');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rama-shiplog-'));
  scratch.push(tmp);
  let ran = null;
  let gitOk = true;
  try {
    fs.mkdirSync(path.join(tmp, 'scripts'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'data', 'logs'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'scripts/shipLog.cjs'), path.join(tmp, 'scripts/shipLog.cjs'));
    const logName = 'build-2026-10-20T00-00-00-000Z.log';
    const raw = `transcript from ${host}\nhome ${home}\nuser ${user}\nC:\\Users\\${user}\\thing\nfailed at stage 4\n`;
    fs.writeFileSync(path.join(tmp, 'data', 'logs', logName), raw);
    const g = (args) => execFileSync('git', args, { cwd: tmp, stdio: 'pipe', encoding: 'utf8' });
    g(['init', '-q']);
    // Local to this throwaway repository only: nothing global or in master's repository is touched.
    g(['config', 'user.email', 'suite@example.invalid']);
    g(['config', 'user.name', 'suite']);
    g(['remote', 'add', 'origin', path.join(tmp, 'no-such-remote.git')]);
    ran = spawnSync(process.execPath, [path.join(tmp, 'scripts/shipLog.cjs'), '--transcripts-only'], {
      cwd: tmp, encoding: 'utf8', timeout: 120000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' },
    });
    const outText = `${ran.stdout || ''}${ran.stderr || ''}`;
    check('it does not fail the caller when the push is impossible', ran.status === 0, `exit ${ran.status}`);
    check('the commit is still made locally', execFileSync('git', ['rev-parse', '--verify', 'refs/heads/build-logs'], { cwd: tmp, encoding: 'utf8' }).trim().length === 40);
    check('it says the push failed, and how to retry', /push failed/i.test(outText) && /git push origin build-logs/.test(outText));
    const box = path.join(tmp, 'data', 'logs', 'outbox');
    const written = fs.existsSync(box) ? fs.readdirSync(box) : [];
    check('A REDACTED COPY IS LEFT WHERE MASTER CAN FIND IT', written.length === 1, written.join());
    check('and the output names that folder', /outbox/.test(outText));
    const copy = written.length ? fs.readFileSync(path.join(box, written[0]), 'utf8') : '';
    check('the copy carries the failure', /failed at stage 4/.test(copy));
    check('the copy carries no username, home or hostname', copy.length > 0
      && !copy.includes(home) && !(user.length > 2 && new RegExp(user, 'i').test(copy)) && !(host.length > 2 && new RegExp(host, 'i').test(copy)), copy.slice(0, 120));
    check('the RAW transcript is left untouched on disk (it is the unredacted one)', fs.readFileSync(path.join(tmp, 'data', 'logs', logName), 'utf8') === raw);
    check('the working tree and branch are untouched: still on the original branch, nothing staged',
      !/build-logs/.test(execFileSync('git', ['symbolic-ref', '--short', 'HEAD'], { cwd: tmp, encoding: 'utf8' }))
      && execFileSync('git', ['status', '--porcelain'], { cwd: tmp, encoding: 'utf8' }).split('\n').every((l) => !/^[AM]/.test(l)));
  } catch (err) {
    gitOk = false;
    check('git is available for the end-to-end check', false, String(err.message).slice(0, 120));
  }
  if (gitOk && ran) {
    const second = spawnSync(process.execPath, [path.join(tmp, 'scripts/shipLog.cjs'), '--transcripts-only'], {
      cwd: tmp, encoding: 'utf8', timeout: 120000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' },
    });
    check('a second attempt adds to the branch rather than replacing it', second.status === 0
      && execFileSync('git', ['rev-list', '--count', 'refs/heads/build-logs'], { cwd: tmp, encoding: 'utf8' }).trim() === '2');
  }

  // ═══ wiring ════════════════════════════════════════════════════════════════════════════════════
  section('where it is wired, and what cannot be committed by accident');
  const bi = fs.readFileSync(path.join(ROOT, 'scripts/buildInstaller.cjs'), 'utf8');
  const sl = fs.readFileSync(path.join(ROOT, 'scripts/shipLog.cjs'), 'utf8');
  const bat = fs.readFileSync(path.join(ROOT, 'Rama.bat'), 'utf8');
  const ignore = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
  check('the promise and the act read one value', /const ship = shouldShip\(/.test(bi) && /if \(ship\) await shipTranscript\(\)/.test(bi) && (bi.match(/if \(ship\)/g) || []).length === 2);
  check('the old condition is gone', !/sawFailure && !noShipLog && !dryRun/.test(bi));
  check('both scripts guard their command line', /if \(require\.main === module\) runCli\(\)/.test(bi) && /if \(require\.main === module\) \{/.test(sl));
  check('the outbox is written on a failed push AND a failed commit', (sl.match(/reportOutbox\(entries\);/g) || []).length === 2);
  check('the outbox lives under data/, which is gitignored, so it can never be committed', /path\.join\(LOG_DIR, 'outbox'\)/.test(sl) && /^data\/$/m.test(ignore));
  check('the menu tells master where the log went when a build fails', /build-logs/.test(bat) && (bat.match(/outbox/g) || []).length === 2);
  check('shipping still cannot change the build exit code', /child\.on\('error', \(\) => resolve\(\)\)/.test(bi) && /child\.on\('close', \(\) => resolve\(\)\)/.test(bi));
  check('no console.log in either script', !/console\.log/.test(bi + sl));

  finished = true;
  console.warn(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((err) => { console.warn('  FAIL  suite crashed: ' + err.stack); finished = true; process.exit(1); });
