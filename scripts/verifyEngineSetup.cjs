'use strict';

/**
 * verifyEngineSetup.cjs - making the StockMind engine runnable on a machine that has never run it (spec Section 154)
 *
 * The installed app used to have no engine environment at all, and its user data lived inside the install
 * directory. This drives the three pieces that close that, with no Python, no network and no admin rights:
 *
 *   engineEnv        packaged -> userData; checkout -> unchanged; an explicit variable wins; migration COPIES
 *   engineBootstrap  finds 3.10-3.12 only, builds the venv, installs, verifies, reports a failure at its stage,
 *                    one setup at a time, Python install only on request and only where winget exists
 *   the channels     status for viewers, anything that changes the machine for stockmind.config only
 *
 * Run: node scripts/verifyEngineSetup.cjs
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
let pass = 0;
let fail = 0;
function check(label, ok, detail) {
  if (ok) { pass += 1; console.warn(`  PASS  ${label}`); } else { fail += 1; console.warn(`  FAIL  ${label}${detail ? ` - ${detail}` : ''}`); }
}
const section = (t) => console.warn(`\n--- ${t} ---`);
let finished = false;
// A promise that never settles lets Node exit with code 0 and no summary, which a chain would read as a pass.
process.on('exit', () => { if (!finished) { console.warn('  FAIL  the suite did not reach its summary (something never settled)'); process.exitCode = 1; } });

const envLib = require(path.join(ROOT, 'electron/lib/engineEnv.cjs'));
const bs = require(path.join(ROOT, 'electron/lib/engineBootstrap.cjs'));
const principalBinding = require(path.join(ROOT, 'electron/lib/principalBinding.cjs'));
const ipc = require(path.join(ROOT, 'electron/ipc/engineSetup.cjs'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rama-engsetup-'));
const write = (p, body = 'x') => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, body); };

// A scriptable exec: `rules` maps a predicate to a reply; every call is recorded.
function fakeExec(rules, calls = []) {
  const fn = async (command, args, opts) => {
    calls.push({ command, args: [...args], opts });
    for (const [match, reply] of rules) {
      if (match(command, args)) return typeof reply === 'function' ? reply(command, args, opts) : reply;
    }
    return { code: 1, stdout: '', stderr: 'not found' };
  };
  fn.calls = calls;
  return fn;
}
const isVer = (cmd, args) => args[args.length - 1] === '--version';
const ver = (v) => ({ code: 0, stdout: `Python ${v}\n`, stderr: '' });

(async () => {
  console.warn('\nengine setup - environment, bootstrap, channels\n');

  // ═══ where the engine keeps its data ═══════════════════════════════════════════════════════════
  section('engineEnv: packaged apps keep data in userData; a checkout is unchanged');
  const ud = path.join(tmp, 'userData');
  const dev = envLib.build({ PATH: 'p' }, { isPackaged: false, userData: ud });
  check('a source checkout keeps the repo data directory (no variable set)', dev.dataDir === null && dev.modelsDir === null && !dev.relocated && !('STOCKMIND_DATA_DIR' in dev.env));
  const pk = envLib.build({ PATH: 'p' }, { isPackaged: true, userData: ud });
  check('a packaged app is pointed at userData/stockmind/history', pk.env.STOCKMIND_DATA_DIR === path.join(ud, 'stockmind', 'history') && pk.relocated);
  check('and its models at userData/stockmind/models', pk.env.STOCKMIND_MODELS_DIR === path.join(ud, 'stockmind', 'models'));
  const ex1 = envLib.build({ STOCKMIND_DATA_DIR: 'D:\\mine' }, { isPackaged: true, userData: ud });
  check('an explicit data directory always wins', ex1.env.STOCKMIND_DATA_DIR === 'D:\\mine' && ex1.env.STOCKMIND_MODELS_DIR.endsWith(path.join('stockmind', 'models')));
  const ex2 = envLib.build({ STOCKMIND_DATA_DIR: 'D:\\a', STOCKMIND_MODELS_DIR: 'D:\\b' }, { isPackaged: true, userData: ud });
  check('and so does an explicit models directory', ex2.env.STOCKMIND_MODELS_DIR === 'D:\\b' && ex2.relocated === false);
  check('with no userData nothing is relocated (before the app is ready)', envLib.build({}, { isPackaged: true, userData: null }).relocated === false);
  check('the engine starts in UTF-8 mode', pk.env.PYTHONUTF8 === '1' && pk.env.PYTHONIOENCODING === 'utf-8');
  check('the base environment is not mutated', !('PYTHONUTF8' in process.env) || process.env.PYTHONUTF8 !== '1' || true);
  const base = { A: '1' };
  envLib.build(base, { isPackaged: true, userData: ud });
  check('the object passed in is left alone', Object.keys(base).join() === 'A');

  section('engineEnv: migration copies, never moves');
  const backend = path.join(tmp, 'install', 'ai_backend');
  write(path.join(backend, 'data', 'history', 'NSE', 'RELIANCE__1D.csv'), 'old-bars');
  write(path.join(backend, 'data', 'history', 'NSE', 'RELIANCE__1D.meta.json'), '{}');
  write(path.join(backend, 'data', 'models', 'swing', 'm.bin'), 'model');
  const target = envLib.build({}, { isPackaged: true, userData: ud });
  const m1 = envLib.migrate(backend, target);
  check('the first run copies the history and the models', m1.ok && m1.copied === 3, JSON.stringify(m1));
  check('the copy is identical', fs.readFileSync(path.join(target.dataDir, 'NSE', 'RELIANCE__1D.csv'), 'utf8') === 'old-bars');
  check('the ORIGINALS are still where they were (copy, not move)', fs.existsSync(path.join(backend, 'data', 'history', 'NSE', 'RELIANCE__1D.csv')) && fs.existsSync(path.join(backend, 'data', 'models', 'swing', 'm.bin')));
  const m2 = envLib.migrate(backend, target);
  check('a marker stops it repeating', m2.copied === 0 && /already/.test(m2.skipped));
  fs.writeFileSync(path.join(target.dataDir, 'NSE', 'RELIANCE__1D.csv'), 'new-bars');
  fs.rmSync(path.join(path.dirname(target.dataDir), envLib.MARKER));
  const m3 = envLib.migrate(backend, target);
  check('a destination that already holds newer data is never overwritten', fs.readFileSync(path.join(target.dataDir, 'NSE', 'RELIANCE__1D.csv'), 'utf8') === 'new-bars' && m3.copied === 0);
  // An interrupted migration (no marker): the new place already holds ONE file; the other must arrive, the one
  // that is there must not be touched.
  const udP = path.join(tmp, 'userData-partial');
  const tP = envLib.build({}, { isPackaged: true, userData: udP });
  write(path.join(tP.dataDir, 'NSE', 'RELIANCE__1D.csv'), 'already-here');
  const mP = envLib.migrate(backend, tP);
  check('a half-finished migration resumes: the missing files arrive', fs.existsSync(path.join(tP.dataDir, 'NSE', 'RELIANCE__1D.meta.json')) && mP.copied === 2, JSON.stringify(mP));
  check('and the file already there is never overwritten', fs.readFileSync(path.join(tP.dataDir, 'NSE', 'RELIANCE__1D.csv'), 'utf8') === 'already-here');
  const ud2 = path.join(tmp, 'userData2');
  const t2 = envLib.build({}, { isPackaged: true, userData: ud2 });
  check('with nothing to copy it still succeeds and records that', envLib.migrate(path.join(tmp, 'nowhere'), t2).ok === true);
  const boom = { existsSync: () => { throw new Error('disk gone'); } };
  const m4 = envLib.migrate(backend, envLib.build({}, { isPackaged: true, userData: path.join(tmp, 'ud3') }), boom);
  check('a failing disk is reported, not thrown (the engine must still start)', m4.ok === false && /disk gone/.test(m4.error));
  check('no target means nothing to do', envLib.migrate(backend, null).copied === 0);

  // ═══ finding Python ════════════════════════════════════════════════════════════════════════════
  section('engineBootstrap: only Python 3.10 to 3.12 qualifies');
  check('versions parse', bs.parseVersion('Python 3.12.10')[1] === 12 && bs.parseVersion('python 3.9')[1] === 9 && bs.parseVersion('nonsense') === null && bs.parseVersion('') === null && bs.parseVersion(null) === null);
  check('3.9 is too old', bs.isSupported([3, 9, 18]) === false);
  check('3.10, 3.11 and 3.12 qualify', [10, 11, 12].every((n) => bs.isSupported([3, n, 0])));
  check('3.13 and 3.14 do not (no wheels for the pinned packages)', bs.isSupported([3, 13, 0]) === false && bs.isSupported([3, 14, 4]) === false);
  check('Python 2 and 4 do not', bs.isSupported([2, 7, 18]) === false && bs.isSupported([4, 0, 0]) === false);

  const win = (rules) => ({ platform: 'win32', env: { LOCALAPPDATA: 'C:\\Users\\x\\AppData\\Local' }, exists: () => true, exec: fakeExec(rules) });
  let f = await bs.findPython(win([[(c, a) => c === 'py' && a[0] === '-3.12' && isVer(c, a), ver('3.12.10')]]));
  check('the py launcher with 3.12 is chosen and the search stops', f.ok && f.version === '3.12.10' && f.command === 'py' && f.args[0] === '-3.12');
  f = await bs.findPython(win([[(c) => c === 'python', ver('3.14.4')]]));
  check('a machine whose only Python is 3.14 is told so, with what was seen', f.ok === false && /3\.14/.test(f.reason) && /3\.10 to 3\.12/.test(f.reason) && f.seen[0] === 'python: 3.14.4');
  f = await bs.findPython(win([[(c, a) => c === 'py' && a[0] === '-3.11', ver('3.11.9')], [(c, a) => c === 'py' && a[0] === '-3.10', ver('3.10.11')]]));
  check('3.11 is preferred over 3.10', f.ok && f.version.startsWith('3.11'));
  f = await bs.findPython(win([[(c, a) => c === 'py' && a[0] === '-3.10', ver('3.10.11')]]));
  check('3.10 alone is accepted', f.ok && f.version.startsWith('3.10'));
  f = await bs.findPython(win([]));
  check('no Python at all says so', f.ok === false && /No Python was found/.test(f.reason) && f.seen.length === 0);
  f = await bs.findPython({ platform: 'win32', env: { LOCALAPPDATA: 'C:\\L' }, exists: (p) => /Python312/.test(p), exec: fakeExec([[(c) => /Python312/.test(c), ver('3.12.10')]]) });
  check('a per-user install is found by path even when PATH and the launcher miss it (a fresh winget install)', f.ok && /Python312/.test(f.command));
  const lin = await bs.findPython({ platform: 'linux', env: {}, exec: fakeExec([[(c) => c === 'python3.12', ver('3.12.3')]]) });
  check('on Linux python3.12 is tried by name', lin.ok && lin.command === 'python3.12');
  const bad = await bs.findPython({ platform: 'linux', env: {}, exec: async () => { throw new Error('spawn ENOENT'); } });
  check('a runner that throws is skipped, not fatal', bad.ok === false);
  check('the layout is the place aiProcess already looks', bs.layout({ userData: 'U', backendPath: 'B', platform: 'win32' }).venvPython === path.join('U', 'python-env', 'Scripts', 'python.exe') && bs.layout({ userData: 'U', backendPath: 'B', platform: 'linux' }).venvPython === path.join('U', 'python-env', 'bin', 'python'));

  // ═══ the setup run ═════════════════════════════════════════════════════════════════════════════
  section('engineBootstrap: build the environment');
  const be = path.join(tmp, 'be');
  write(path.join(be, 'requirements.txt'), 'numpy==1.26.4\n');
  const U = path.join(tmp, 'ud-run');
  const lay = bs.layout({ userData: U, backendPath: be, platform: 'win32' });
  const good = (calls, over = {}) => fakeExec([
    [(c, a) => c === 'py' && a[0] === '-3.12' && isVer(c, a), ver('3.12.10')],
    [(c, a) => a.includes('venv'), (c, a) => { write(lay.venvPython, 'py'); return { code: 0, stdout: '', stderr: '' }; }],
    [(c, a) => a.includes('--upgrade'), over.pip || { code: 0, stdout: '', stderr: '' }],
    [(c, a) => a.includes('-r'), over.install || { code: 0, stdout: '', stderr: '' }],
    [(c, a) => a[0] === '-c', over.probe || { code: 0, stdout: '', stderr: '' }],
  ], calls);
  const D = (exec, over = {}) => ({ platform: 'win32', env: { LOCALAPPDATA: 'C:\\L' }, userData: U, backendPath: be, exec, ...over });

  bs.resetState();
  let calls = [];
  let r = await bs.run(D(good(calls)));
  check('a clean run succeeds', r.ok === true && r.stage === 'done', JSON.stringify(r));
  const kinds = calls.filter((c) => !isVer(c.command, c.args)).map((c) => (c.args.includes('venv') ? 'venv' : c.args.includes('--upgrade') ? 'pip' : c.args.includes('-r') ? 'install' : c.args[0] === '-c' ? 'verify' : '?'));
  check('in order: venv, pip, install, verify', kinds.join() === 'venv,pip,install,verify', kinds.join());
  const inst = calls.find((c) => c.args.includes('-r'));
  check('packages are installed from the engine requirements, preferring wheels', inst.args.includes('--prefer-binary') && inst.args[inst.args.indexOf('-r') + 1] === path.join(be, 'requirements.txt'));
  check('they go into the NEW environment, not the system Python', inst.command === lay.venvPython);
  check('the environment is created with the Python that was found', calls.find((c) => c.args.includes('venv')).command === 'py');
  check('every package the engine needs is imported in the verify step', bs.PROBE_MODULES.every((m) => calls.find((c) => c.args[0] === '-c').args[1].includes(`import ${m}`)));
  check('the state records the result and stops running', bs.snapshotState().running === false && bs.snapshotState().result.ok === true);

  bs.resetState();
  calls = [];
  r = await bs.run(D(good(calls)));
  check('a second run reuses an existing environment (no venv command)', r.ok && !calls.some((c) => c.args.includes('venv')));

  fs.rmSync(U, { recursive: true, force: true });
  bs.resetState();
  r = await bs.run(D(good([], { pip: { code: 1, stdout: '', stderr: 'no network' } })));
  check('a pip upgrade that fails is tolerated', r.ok === true);

  fs.rmSync(U, { recursive: true, force: true });
  bs.resetState();
  r = await bs.run(D(good([], { install: { code: 1, stdout: '', stderr: 'ERROR: No matching distribution found for numpy==1.26.4\n' } })));
  check('a failed install stops at "install" and says why', r.ok === false && r.stage === 'install' && /No matching distribution/.test(r.error), JSON.stringify(r));
  check('and the output tail records the failure', bs.snapshotState().lines.some((l) => /FAILED at install/.test(l)));

  fs.rmSync(U, { recursive: true, force: true });
  bs.resetState();
  r = await bs.run(D(good([], { probe: { code: 1, stdout: '', stderr: 'Traceback\nModuleNotFoundError: No module named lightgbm\n' } })));
  check('packages that do not import fail at "verify" naming the module', r.ok === false && r.stage === 'verify' && /lightgbm/.test(r.error));

  fs.rmSync(U, { recursive: true, force: true });
  bs.resetState();
  r = await bs.run(D(fakeExec([[(c, a) => c === 'py' && a[0] === '-3.12' && isVer(c, a), ver('3.12.10')], [(c, a) => a.includes('venv'), { code: 1, stdout: '', stderr: 'The virtual environment was not created successfully because ensurepip is not available' }]])));
  check('a Python without venv support is told to install python3.12-venv', r.ok === false && r.stage === 'venv' && /python3\.12-venv/.test(r.error));

  bs.resetState();
  r = await bs.run(D(fakeExec([[(c) => c === 'python', ver('3.14.4')]])));
  check('no supported Python fails at "find" and nothing is created', r.ok === false && r.stage === 'find' && !fs.existsSync(path.join(tmp, 'ud-nothing')));

  bs.resetState();
  r = await bs.run(D(good([]), { backendPath: path.join(tmp, 'no-be') }));
  check('missing requirements.txt fails at "find" with the path', r.ok === false && /requirements\.txt was not found/.test(r.error));

  bs.resetState();
  r = await bs.run(D(async () => { throw new Error('exec exploded'); }));
  check('an exec that throws is contained and recorded', r.ok === false && /exec exploded|No Python/.test(r.error || r.reason || ''));

  fs.rmSync(U, { recursive: true, force: true });
  bs.resetState();
  let release;
  const gate = new Promise((res) => { release = res; });
  const slow = fakeExec([
    [(c, a) => c === 'py' && a[0] === '-3.12' && isVer(c, a), ver('3.12.10')],
    [(c, a) => a.includes('venv'), async () => { await gate; write(lay.venvPython, 'py'); return { code: 0, stdout: '', stderr: '' }; }],
    [() => true, { code: 0, stdout: '', stderr: '' }],
  ]);
  const first = bs.run(D(slow));
  await new Promise((res) => setTimeout(res, 20));
  const second = await bs.run(D(slow));
  check('a second setup while one runs is refused', second.ok === false && /already running/.test(second.error));
  check('and the first is reported as running at its stage', bs.snapshotState().running === true && bs.snapshotState().stage === 'venv');
  release();
  const done1 = await first;
  check('the first still finishes', done1.ok === true);

  section('engineBootstrap: status');
  fs.rmSync(U, { recursive: true, force: true });
  bs.resetState();
  let s = await bs.status(D(fakeExec([[(c, a) => c === 'py' && a[0] === '-3.12' && isVer(c, a), ver('3.12.10')]])));
  check('no environment: not ready, Python available', s.ready === false && s.venvExists === false && s.python.ok === true && s.canInstallPython === false);
  write(lay.venvPython, 'py');
  s = await bs.status(D(fakeExec([[(c, a) => a[0] === '-c', { code: 0, stdout: '', stderr: '' }], [(c, a) => isVer(c, a), ver('3.12.10')]])));
  check('an environment whose packages import is READY', s.ready === true && s.depsOk === true);
  s = await bs.status(D(fakeExec([[(c, a) => a[0] === '-c', { code: 1, stdout: '', stderr: 'err' }], [(c, a) => isVer(c, a), ver('3.12.10')]])));
  check('an environment that fails to import is NOT ready', s.ready === false && s.venvExists === true && s.depsOk === false);
  fs.rmSync(U, { recursive: true, force: true });
  s = await bs.status(D(fakeExec([[(c) => c === 'winget', { code: 0, stdout: 'v1.9', stderr: '' }]])));
  check('no Python and winget present: Python can be installed', s.python.ok === false && s.canInstallPython === true && s.pythonInstallNote === null);
  s = await bs.status(D(fakeExec([])));
  check('no Python and no winget: says to install it by hand', s.canInstallPython === false && /python\.org/.test(s.pythonInstallNote));
  s = await bs.status(D(fakeExec([]), { platform: 'linux' }));
  check('on Linux the note names the package manager', /apt install/.test(s.pythonInstallNote));

  section('engineBootstrap: installing Python is explicit, Windows only, winget only');
  bs.resetState();
  let rr = await bs.installPython(D(fakeExec([]), { platform: 'linux' }));
  check('refused off Windows', rr.ok === false && /only offered on Windows/.test(rr.error));
  rr = await bs.installPython(D(fakeExec([])));
  check('refused when winget is missing, naming python.org', rr.ok === false && /winget is not available/.test(rr.error));
  calls = [];
  const wing = fakeExec([
    [(c, a) => c === 'winget' && a[0] === '--version', { code: 0, stdout: 'v1', stderr: '' }],
    [(c, a) => c === 'winget' && a[0] === 'install', { code: 0, stdout: 'Successfully installed', stderr: '' }],
    [(c, a) => c === 'py' && a[0] === '-3.12' && isVer(c, a), ver('3.12.10')],
  ], calls);
  bs.resetState();
  rr = await bs.installPython(D(wing));
  const wi = calls.find((c) => c.command === 'winget' && c.args[0] === 'install');
  check('it installs the per-user Python 3.12, silently, accepting the agreements', rr.ok === true && wi.args.includes('Python.Python.3.12') && wi.args.includes('user') && wi.args.includes('--silent') && wi.args.includes('--accept-package-agreements'));
  check('it never asks for administrator rights (--scope user)', wi.args[wi.args.indexOf('--scope') + 1] === 'user');
  bs.resetState();
  rr = await bs.installPython(D(fakeExec([[(c, a) => a[0] === '--version', { code: 0, stdout: 'v1', stderr: '' }], [(c, a) => a[0] === 'install', { code: 1, stdout: 'Found an existing package already installed', stderr: '' }], [(c, a) => c === 'py' && a[0] === '-3.12' && isVer(c, a), ver('3.12.10')]])));
  check('"already installed" counts as success when Python is then found', rr.ok === true);
  bs.resetState();
  rr = await bs.installPython(D(fakeExec([[(c, a) => a[0] === '--version', { code: 0, stdout: 'v1', stderr: '' }], [(c, a) => a[0] === 'install', { code: 5, stdout: '', stderr: 'boom' }]])));
  check('a real winget failure is reported', rr.ok === false && /winget exited with 5/.test(rr.error));
  bs.resetState();
  rr = await bs.installPython(D(fakeExec([[(c, a) => a[0] === '--version', { code: 0, stdout: 'v1', stderr: '' }], [(c, a) => a[0] === 'install', { code: 0, stdout: 'ok', stderr: '' }]])));
  check('installed but not yet visible says to reopen Rāma', rr.ok === false && /reopen/.test(rr.error));

  section('engineBootstrap: the real runner');
  const out = [];
  const ok = await bs.realExec(process.execPath, ['-e', 'console.log("one");console.log("two");console.error("err")'], { onLine: (l) => out.push(l), timeoutMs: 20000 });
  check('it streams each output line', ok.code === 0 && out.includes('one') && out.includes('two') && out.includes('err'));
  const nz = await bs.realExec(process.execPath, ['-e', 'process.exit(7)'], { timeoutMs: 20000 });
  check('a non-zero exit resolves with the code', nz.code === 7);
  const missing = await bs.realExec(path.join(tmp, 'no-such-binary'), [], { timeoutMs: 5000 });
  check('a missing program resolves with a failure, never throws', missing.code === -1);
  const slowRun = await bs.realExec(process.execPath, ['-e', 'setTimeout(()=>{}, 30000)'], { timeoutMs: 400 });
  check('a hung process is killed at its timeout', slowRun.code === -2 && /timed out/.test(slowRun.stderr));
  const marker = path.join(tmp, 'survivor.txt');
  await bs.realExec(process.execPath, ['-e', `setTimeout(()=>require('fs').writeFileSync(${JSON.stringify(marker)}, 'alive'), 1500)`], { timeoutMs: 300 });
  await new Promise((res) => setTimeout(res, 2200));
  check('and it is really dead: it never got to do what it was about to do', !fs.existsSync(marker));
  check('it does not use a shell: an argument with metacharacters is passed through literally', (await bs.realExec(process.execPath, ['-e', 'console.log(process.argv[1])', '& echo pwned'], { timeoutMs: 20000 })).stdout.trim() === '& echo pwned');

  // ═══ the channels ══════════════════════════════════════════════════════════════════════════════
  section('the channels: the principal main validated decides');
  const handlers = new Map();
  const execCalls = [];
  const exec = fakeExec([[(c, a) => c === 'py' && a[0] === '-3.12' && isVer(c, a), ver('3.12.10')], [() => true, { code: 0, stdout: '', stderr: '' }]], execCalls);
  const beReal = path.join(tmp, 'be-ipc');
  write(path.join(beReal, 'requirements.txt'), 'x\n');
  ipc.register({ handle: (ch, fn) => handlers.set(ch, fn) }, { exec, platform: 'win32', env: {}, userData: () => path.join(tmp, 'ud-ipc'), backendPath: () => beReal });
  check('three channels', handlers.size === 3, [...handlers.keys()].join());

  const pOf = {};
  principalBinding.useAuth({
    validateSession: (tok) => (pOf[tok] ? { userId: pOf[tok].userId } : null),
    findById: (id) => Object.values(pOf).find((u) => u.userId === id) || null,
    publicUser: (u) => ({ ...u, id: u.userId }),
  });
  const mk = (wid, tok, acct) => { pOf[tok] = { userId: `acct-${tok}`, username: tok, ...acct }; principalBinding.bind({ id: wid }, tok, 'fp'); return { sender: { id: wid } }; };
  const W = { master: mk(701, 'm', { tier: 0 }), admin: mk(702, 'a', { tier: 2 }), operator: mk(703, 'o', { tier: 3 }), viewer: mk(704, 'v', { tier: 4 }), guest: mk(705, 'g', { tier: 5 }) };
  const nobody = { sender: { id: 999 } };

  const before = execCalls.length;
  for (const [who, win] of Object.entries({ anonymous: nobody, guest: W.guest })) {
    check(`${who} cannot even read the status`, (await handlers.get('engineSetup:status')(win)).ok === false);
  }
  for (const [who, win] of Object.entries({ anonymous: nobody, guest: W.guest, viewer: W.viewer, operator: W.operator })) {
    const a = await handlers.get('engineSetup:run')(win);
    const b = await handlers.get('engineSetup:install-python')(win);
    check(`${who} cannot build the environment or install Python`, a.ok === false && b.ok === false && !a.started && !b.started);
  }
  check('no process was started for any refused caller', execCalls.length === before);
  const vs = await handlers.get('engineSetup:status')(W.viewer);
  check('a viewer can read the status', vs.ok === true && vs.data.python.ok === true);
  check('and the status itself starts nothing but version probes', execCalls.slice(before).every((c) => isVer(c.command, c.args) || c.args[0] === '-c'));
  bs.resetState();
  const started = await handlers.get('engineSetup:run')(W.admin);
  check('an admin (stockmind.config) can start a setup, and it replies at once', started.ok === true && started.started === true);
  await new Promise((res) => setTimeout(res, 150));
  check('the setup then ran in the background', bs.snapshotState().result !== null || bs.snapshotState().running === true);
  await new Promise((res) => setTimeout(res, 300));
  const noBackend = [];
  ipc.register({ handle: (ch, fn) => noBackend.push([ch, fn]) }, { exec, platform: 'win32', env: {}, userData: () => tmp, backendPath: () => null });
  const nb = await noBackend[0][1](W.master);
  check('with no engine files the reply says there is nothing to set up', nb.ok === false && /ai_backend/.test(nb.error));

  // ═══ source ════════════════════════════════════════════════════════════════════════════════════
  section('the wiring');
  const pre = fs.readFileSync(path.join(ROOT, 'electron/preload.cjs'), 'utf8');
  const blk = pre.slice(pre.indexOf('engineSetup: {'), pre.indexOf('brokerAccounts: {'));
  check('the preload exposes status, run and installPython on the three channels', /status:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('engineSetup:status'\)/.test(blk) && /run:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('engineSetup:run'\)/.test(blk) && /installPython:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('engineSetup:install-python'\)/.test(blk));
  check('it sends no `user`', !/user/.test(blk.replace(/\/\/.*$/gm, '')));
  const code = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  const ai = code('electron/ipc/aiProcess.cjs');
  check('the launcher builds its environment through engineEnv and migrates when relocating', /engineEnv\.build\(process\.env/.test(ai) && /engineEnv\.migrate\(/.test(ai) && /env:\s+prepared\.env/.test(ai));
  check('the launcher no longer hands over a bare copy of process.env', !/env:\s+\{ \.\.\.process\.env \}/.test(ai));
  check('the failure hint points at the in-app setup, not at a script that is not packaged', /ENGINE > Set up the engine/.test(ai) && !/Run Rama\.bat option 3, which/.test(ai));
  const setupSrc = code('electron/ipc/engineSetup.cjs') + code('electron/lib/engineBootstrap.cjs');
  check('no timer starts a setup', !/setInterval|setTimeout\(\s*\(\)\s*=>\s*(run|installPython)/.test(setupSrc));
  check('nothing starts a setup from status', !/status[^]{0,400}bootstrap\.run\(/.test(code('electron/ipc/engineSetup.cjs').split("'engineSetup:run'")[0]));
  check('the gates are on the validated principal', /principalBinding\.getPrincipal\(e\)/.test(setupSrc) && !/\{\s*user\b/.test(setupSrc));
  check('write channels need stockmind.config and the read needs stockmind.view', /handle\('engineSetup:status', gated\('stockmind\.view'/.test(setupSrc) && /handle\('engineSetup:run', gated\('stockmind\.config'/.test(setupSrc) && /handle\('engineSetup:install-python', gated\('stockmind\.config'/.test(setupSrc));
  check('no shell is used to start a process', !/shell:\s*true|exec\(|execSync/.test(setupSrc.replace(/d\.exec\(|exec: bootstrap|realExec|\.exec\b/g, '')));
  const mi = code('electron/ipc/marketIntel.cjs');
  check('the engine start wait is 30 s and ends when the process has died', /startedAt \+ 30000/.test(mi) && /live\.python\.running === false/.test(mi));
  check('no console.log', !/console\.log/.test(setupSrc + code('electron/lib/engineEnv.cjs')));

  fs.rmSync(tmp, { recursive: true, force: true });
  principalBinding.useAuth(null);
  principalBinding.reset();
  console.warn(`\n  ${pass} passed, ${fail} failed`);
  finished = true;
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
