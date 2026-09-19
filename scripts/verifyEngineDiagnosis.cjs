'use strict';

/**
 * verifyEngineDiagnosis.cjs — does "backend not reachable" say WHY? (spec Section 99)
 *
 * Master reported "backend not reachable". That message came from a `/health` poll timing out, so it
 * described a connection refusal and said nothing about the cause — and the cause had been printed on
 * the engine's stderr, which was broadcast to open windows and then discarded. A missing Python
 * package and a wrong interpreter produced the identical sentence.
 *
 * `diagnoseFailure` is pure, so it is tested here without spawning Python or loading Electron.
 *
 * Run: node scripts/verifyEngineDiagnosis.cjs   (or npm run verify:engine)
 */

// Required by path, because `electron/ipc/aiProcess.cjs` requires `electron` at module scope and this
// suite must run under plain node. Only the pure function is needed.
const fs = require('fs');
const path = require('path');
const Module = require('module');

// The Section 106 checks read both source files, because the defect was not in `diagnoseFailure` — it
// was in the GATE in front of it, and a gate is only visible in the source that guards the call.
const ROOT = path.join(__dirname, '..');

const target = path.join(__dirname, '..', 'electron', 'ipc', 'aiProcess.cjs');

// A minimal `electron` stand-in so the module can load outside the shell. Nothing below touches it.
const realResolve = Module._resolveFilename;
Module._resolveFilename = function patched(request, ...rest) {
  if (request === 'electron') return 'electron-stub';
  return realResolve.call(this, request, ...rest);
};
require.cache['electron-stub'] = {
  id: 'electron-stub', filename: 'electron-stub', loaded: true,
  exports: { app: { getAppPath: () => process.cwd() }, BrowserWindow: { getAllWindows: () => [] } },
};

const { diagnoseFailure } = require(target);
Module._resolveFilename = realResolve;

let pass = 0;
let fail = 0;
function check(label, ok, detail) {
  if (ok) { pass += 1; console.log(`  PASS  ${label}`); }
  else { fail += 1; console.log(`  FAIL  ${label}${detail ? ` - ${detail}` : ''}`); }
}

console.log('\nengine failure diagnosis — the reason, not the symptom\n');

// ── The case master is almost certainly hitting ───────────────────────────────
console.log('  missing python packages');
{
  const d = diagnoseFailure({
    stderr: [
      'Traceback (most recent call last):',
      '  File "main.py", line 49, in <module>',
      '    from fastapi import FastAPI, HTTPException',
      "ModuleNotFoundError: No module named 'fastapi'",
    ],
    exit: { code: 1, signal: null, interpreter: 'python' },
  });

  check('the missing module is named', /fastapi/.test(d.reason), d.reason);
  check('and identified as an install problem, not a crash',
    /packages are not installed/.test(d.reason), d.reason);
  // A remedy master can run, rather than "check the logs".
  check('the remedy names Rama.bat option 3', /option 3/.test(d.remedy), d.remedy);
  check('and gives the manual command too', /pip install -r/.test(d.remedy));
  // Ordering matters: this must win over the generic non-zero exit branch.
  check('a missing package outranks the generic exit-code message',
    !/exited with code/.test(d.reason), d.reason);
}

// ── The other real causes ─────────────────────────────────────────────────────
console.log('\n  other causes are distinguished');
{
  const port = diagnoseFailure({
    stderr: ['ERROR: [Errno 10048] error while attempting to bind on address'],
    exit: { code: 1 },
  });
  check('a bound port is recognised even from the WinError form',
    /already in use/.test(port.reason), port.reason);
  check('and the remedy names the override', /STOCKMIND_PYTHON_PORT/.test(port.remedy));

  const syntax = diagnoseFailure({
    stderr: ['  File "engine/models.py", line 12', 'SyntaxError: invalid syntax'],
    exit: { code: 1 },
  });
  check('a parse failure is called out as a version mismatch',
    /failed to parse/.test(syntax.reason) && /3\.10 to 3\.12/.test(syntax.remedy), syntax.remedy);

  const noPy = diagnoseFailure({
    stderr: ['[ai_backend] could not start: Python was not found on PATH'],
  });
  check('a missing interpreter is distinguished from a missing package',
    /interpreter could not be started/.test(noPy.reason), noPy.reason);
  check('and RAMA_PYTHON is offered', /RAMA_PYTHON/.test(noPy.remedy));

  const generic = diagnoseFailure({ stderr: ['something unexpected'], exit: { code: 3, interpreter: 'py' } });
  check('an unrecognised failure still reports the exit code',
    /exited with code 3/.test(generic.reason), generic.reason);
  // Naming the interpreter matters when RAMA_PYTHON points somewhere unexpected.
  check('and names the interpreter that produced it', /py/.test(generic.reason));
}

// ── Absence must not be reported as a diagnosis ───────────────────────────────
console.log('\n  silence is its own answer');
{
  const silent = diagnoseFailure({ stderr: [], exit: null });
  check('no output and no exit is reported as exactly that',
    /no engine process is running/.test(silent.reason), silent.reason);
  check('and still carries a next step', silent.remedy.length > 10);
  check('and it points at the Python runtime, which is the thing to check',
    /Rama\.bat option 2/.test(silent.remedy), silent.remedy);

  const started = diagnoseFailure({ stderr: ['INFO: Started server process'], exit: null });
  // Started but unanswering is a different situation from crashed, and must not be conflated.
  check('a running-but-silent engine is not called a crash',
    /did not answer/.test(started.reason), started.reason);

  check('called with nothing at all it does not throw',
    typeof diagnoseFailure().reason === 'string');
  check('every branch returns both a reason and a remedy',
    [{}, { stderr: [] }, { exit: { code: 0 } }, { stderr: ['x'], exit: { code: 1 } }]
      .every(i => {
        const d = diagnoseFailure(i);
        return typeof d.reason === 'string' && d.reason
          && typeof d.remedy === 'string' && d.remedy;
      }));
}

// ── THE CASE MASTER ACTUALLY HIT (spec Section 106) ───────────────────────────
//
// He reported: "engine is not running, showing the IP and the above message." That was the caller's raw
// fallback, and it fired because `getRunningStatus` gated the whole diagnosis behind
// `lastExit || lastStderr.length` — so the branch written for silence could only run when there WAS
// output, and could never run. Section 99 deleted the undiagnosable message from every case that
// produces output and left it in the one case that does not.
console.log('\n  the silent cases, which were unreachable before');
{
  const alive = diagnoseFailure({ stderr: [], exit: null, running: true, interpreter: 'C:/py/python.exe' });
  check('an alive-but-silent engine says it is still starting rather than broken',
    /alive but has not answered/.test(alive.reason), alive.reason);
  check('and suggests waiting, because a cold import genuinely takes seconds',
    /try again/i.test(alive.remedy), alive.remedy);
  check('and names the interpreter it is running under',
    /python\.exe/.test(alive.remedy), alive.remedy);
  check('it is marked as silent so a caller can treat it differently', alive.silent === true);

  const dead = diagnoseFailure({
    stderr: [], exit: null, running: false,
    interpreter: 'python', backendDir: 'C:/app/resources/ai_backend',
  });
  check('a never-spawned engine is distinguished from an alive one',
    dead.reason !== alive.reason, `${dead.reason} vs ${alive.reason}`);
  check('and names the engine directory, because a missing one looks identical otherwise',
    /ai_backend/.test(dead.remedy), dead.remedy);

  // The property that matters: the function is TOTAL. Gating it behind evidence is what broke it, so
  // the fix is only safe if every input — including no input — yields something master can act on.
  const inputs = [
    {}, { stderr: [] }, { stderr: [], exit: null, running: false },
    { stderr: [], exit: null, running: true }, { stderr: [''], exit: null },
    { stderr: null, exit: null }, { exit: { code: null } }, { running: true },
    { stderr: ['ok'], exit: { code: 0 } },
  ];
  check('every input yields a reason AND a remedy, silence included',
    inputs.every((i) => {
      const d = diagnoseFailure(i);
      return d && typeof d.reason === 'string' && d.reason.length > 10
        && typeof d.remedy === 'string' && d.remedy.length > 10;
    }),
    JSON.stringify(inputs.filter((i) => {
      const d = diagnoseFailure(i);
      return !(d && d.reason?.length > 10 && d.remedy?.length > 10);
    })));
  check('no diagnosis ever contains a bare URL or an IP, which is what master was shown',
    inputs.every((i) => {
      const d = diagnoseFailure(i);
      return !/\d+\.\d+\.\d+\.\d+|https?:\/\//.test(`${d.reason} ${d.remedy}`);
    }));
  check('nothing returns null, because null is what sent the caller to its raw fallback',
    inputs.every((i) => diagnoseFailure(i) !== null && diagnoseFailure(i) !== undefined));
}

// ── The gate that made the above unreachable must not come back ───────────────
console.log('\n  the status object always offers a diagnosis when the engine is down');
{
  const src = fs.readFileSync(path.join(ROOT, 'electron', 'ipc', 'aiProcess.cjs'), 'utf8');
  check('the evidence gate is gone from getRunningStatus',
    !/diagnosis:\s*\(!processes\['python'\]\s*&&\s*\(lastExit\s*\|\|\s*lastStderr\.length\)\)/.test(src),
    'the `lastExit || lastStderr.length` gate is back — it makes the silent branch unreachable');
  check('a live-but-silent engine is reported separately from a failed one',
    /notAnswering:/.test(src));
  check('the interpreter and engine directory are retained for a silent failure',
    /resolvedInterpreter/.test(src) && /resolvedBackendDir/.test(src));
  check('a missing ai_backend leaves a trace on the stderr ring rather than only returning',
    /lastStderr\.push\([\s\S]{0,80}ai_backend directory not found/.test(src));

  const mi = fs.readFileSync(path.join(ROOT, 'electron', 'ipc', 'marketIntel.cjs'), 'utf8');
  check('the caller no longer makes the URL its headline',
    !/error:\s*diagnosis\s*\n?\s*\?/.test(mi) && !/Backend not reachable at \$\{BASE_URL\}/.test(mi),
    'the raw `Backend not reachable at <url>` fallback is back');
  check('the caller falls back to diagnoseFailure rather than to a connection string',
    /aiProcess\.diagnoseFailure\(/.test(mi));
  check('the URL survives as a detail field, because where Rama knocked is still worth recording',
    /detail\b/.test(mi) && /BASE_URL/.test(mi));
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
