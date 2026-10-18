#!/usr/bin/env node
/**
 * verifyEngineSetupUi.mjs - what the "Set up the engine" panel says and offers (spec Section 154)
 *
 * The panel appears when StockMind cannot run. This proves it tells the truth about WHY (which Python, and why
 * it does not qualify), offers Python installation only when the main process said it can, claims "ready" only
 * when the packages import, and polls only while something is running.
 *
 * Run: node scripts/verifyEngineSetupUi.mjs   (or npm run verify:engine-setup-ui)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as M from '../src/pages/StockMind/engineSetupModel.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0;
let fail = 0;
const check = (label, ok, detail) => {
  if (ok) { pass += 1; console.log(`  PASS  ${label}`); }
  else { fail += 1; console.log(`  FAIL  ${label}${detail ? ` - ${detail}` : ''}`); }
};

const st = (o = {}) => ({
  ready: false, venvExists: false, depsOk: false, venvDir: 'C:\\U\\python-env',
  python: { ok: true, version: '3.12.10', label: 'py -3.12', seen: ['py -3.12: 3.12.10'] },
  canInstallPython: false, pythonInstallNote: null,
  setup: { running: false, stage: null, lines: [], result: null }, ...o,
});

console.log('\n--- the state ---');
check('nothing known yet is "unknown", not ready', M.stateOf(null) === 'unknown' && !/ready/i.test(M.headline(null)));
check('Python present, no environment: needs setup', M.stateOf(st()) === 'needs-setup');
check('no usable Python: needs Python', M.stateOf(st({ python: { ok: false, reason: 'x', seen: [] } })) === 'needs-python');
check('an environment whose packages import is ready', M.stateOf(st({ ready: true, venvExists: true, depsOk: true })) === 'ready');
check('an environment that exists but does not import is NOT ready', M.stateOf(st({ venvExists: true, depsOk: false })) !== 'ready');
check('a running setup outranks everything', M.stateOf(st({ ready: true, setup: { running: true, stage: 'install', lines: [] } })) === 'running');
check('a failed setup is "failed"', M.stateOf(st({ setup: { running: false, result: { ok: false, stage: 'install', error: 'pip exited with 1' }, lines: [] } })) === 'failed');
check('a failed setup does not hide that the engine is ready if it is', M.stateOf(st({ ready: true, setup: { running: false, result: { ok: false, stage: 'pip' }, lines: [] } })) === 'ready');

console.log('\n--- what it says ---');
const noPy = st({ python: { ok: false, reason: 'Python was found (python: 3.14.4) but none is 3.10 to 3.12.', seen: ['python: 3.14.4'] }, canInstallPython: true });
check('the headline names the requirement', /Python 3\.10 to 3\.12/.test(M.headline(noPy)));
check('the detail says what was found and why it does not qualify', M.details(noPy).some((d) => /3\.14\.4/.test(d)) && M.details(noPy).some((d) => /no wheels/.test(d) && /3\.13/.test(d)));
check('a ready environment shows where it is', M.details(st({ ready: true, venvExists: true, depsOk: true })).some((d) => /python-env/.test(d)));
check('a broken environment says setup will repair it', M.details(st({ venvExists: true, depsOk: false })).some((d) => /repair/.test(d)));
check('a failure names the stage and repeats the error', /Setup stopped at "Installing the engine packages"/.test(M.headline(st({ setup: { running: false, result: { ok: false, stage: 'install', error: 'pip exited with 1' }, lines: [] } }))) && M.details(st({ setup: { running: false, result: { ok: false, stage: 'install', error: 'pip exited with 1' }, lines: [] } })).includes('pip exited with 1'));
check('a running setup names its stage', M.headline(st({ setup: { running: true, stage: 'venv', lines: [] } })) === 'Creating the engine environment ...');
check('an unknown stage still reads as work, not as a crash', M.stageLabel('zzz') === 'Working');
check('the install-by-hand note shows when winget is missing', M.details(st({ python: { ok: false, reason: 'No Python was found.', seen: [] }, pythonInstallNote: 'Install Python 3.12 from python.org' })).some((d) => /python\.org/.test(d)));

console.log('\n--- what it offers ---');
check('a viewer sees the state and no buttons that change anything', (() => { const a = M.actions(st(), false); return !a.setup && !a.installPython && a.refresh && /can see/.test(a.why); })());
check('an account that may configure gets "set up" when Python is there', M.actions(st(), true).setup === true && M.actions(st(), true).installPython === false);
check('with no Python it offers to install one ONLY if the main process said it can', M.actions(noPy, true).installPython === true && M.actions(st({ python: { ok: false, reason: 'x', seen: [] }, canInstallPython: false }), true).installPython === false);
check('with no Python it does not offer setup (it would fail at the first step)', M.actions(noPy, true).setup === false);
check('nothing is offered while a setup runs', (() => { const a = M.actions(st({ setup: { running: true, stage: 'install', lines: [] } }), true); return !a.setup && !a.installPython; })());
check('nothing is offered when the engine is ready', (() => { const a = M.actions(st({ ready: true, venvExists: true, depsOk: true }), true); return !a.setup && !a.installPython; })());
check('after a failure it offers to try again', M.actions(st({ setup: { running: false, result: { ok: false, stage: 'install' }, lines: [] } }), true).setup === true);
check('no state at all offers nothing', !M.actions(null, true).setup);

console.log('\n--- polling and output ---');
check('it polls only while running', M.shouldPoll(st({ setup: { running: true, lines: [] } })) === true && M.shouldPoll(st()) === false && M.shouldPoll(null) === false);
check('only the last twelve output lines are shown', M.outputLines(st({ setup: { running: true, lines: Array.from({ length: 40 }, (_, i) => `l${i}`) } })).length === 12 && M.outputLines(st({ setup: { running: true, lines: Array.from({ length: 40 }, (_, i) => `l${i}`) } })).slice(-1)[0] === 'l39');
check('junk does not throw', (() => { try { M.outputLines(null); M.details(undefined); M.actions({}, true); M.headline({}); M.stateOf({ setup: null }); return true; } catch { return false; } })());

console.log('\n--- the component, read as source ---');
const src = fs.readFileSync(path.join(ROOT, 'src/pages/StockMind/EngineSetup.jsx'), 'utf8');
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
check('opening the panel only READS the state', /useEffect\(\(\) => \{ if \(inBridge\) refresh\(\); \}, \[refresh\]\)/.test(code));
check('a setup starts only from a click', /onClick=\{\(\) => begin\(\(\) => window\.rama\.engineSetup\.run\(\)\)\}/.test(code) && (code.match(/engineSetup\.run\(\)/g) || []).length === 1);
check('so does the Python install', /onClick=\{\(\) => begin\(\(\) => window\.rama\.engineSetup\.installPython\(\)\)\}/.test(code) && (code.match(/engineSetup\.installPython\(\)/g) || []).length === 1);
check('polling is tied to shouldPoll and cleaned up', /if \(!shouldPoll\(st\)\) return undefined;/.test(code) && /clearInterval/.test(code) && (code.match(/setInterval/g) || []).length === 1);
check('the install button says it downloads from the internet and is per-user', /per-user|for this user only/.test(src) && /internet/.test(src));
check('every bridge member it calls is in the preload', (() => { const pre = fs.readFileSync(path.join(ROOT, 'electron/preload.cjs'), 'utf8'); const blk = pre.slice(pre.indexOf('engineSetup: {'), pre.indexOf('brokerAccounts: {')); return ['status', 'run', 'installPython'].every((m) => new RegExp(`${m}:\\s*\\(\\)`).test(blk) && code.includes(`engineSetup.${m}(`)); })());
check('no font size is a literal number', !/fontSize:\s*['"]?\d/.test(code));
check('no console.log', !/console\.log/.test(code));
const sm = fs.readFileSync(path.join(ROOT, 'src/pages/StockMind/StockMind.jsx'), 'utf8');
check('the ENGINE tab shows it with the config permission', /tab === 'engine' && <EngineSetup canConfig=\{canConfig\} \/>/.test(sm) && /import EngineSetup from '\.\/EngineSetup\.jsx'/.test(sm));

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
