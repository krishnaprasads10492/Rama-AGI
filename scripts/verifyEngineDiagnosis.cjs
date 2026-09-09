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
const path = require('path');
const Module = require('module');

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
    /produced no output/.test(silent.reason), silent.reason);
  check('and still carries a next step', silent.remedy.length > 10);

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

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
