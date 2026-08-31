#!/usr/bin/env node
'use strict';

/**
 * verifyUpdateEngine.cjs — the update engine's classification and targeting (spec Section 80).
 *
 * WHY THIS FILE EXISTS. `classifyChange` decides whether pulled code is actually loaded. When it
 * returned `null` for `ai_backend/`, a pull reported success, put the files on disk, and left the
 * running Python engine serving the old module set — new routes 404'd against a repo that visibly
 * contained them. That is the worst shape a bug can take, and it is exactly the "security- or
 * data-critical" bar that requires a behavioural test rather than a review.
 *
 * `localUpdateEngine` takes `packaged`/`appPath` as INJECTED values rather than reading `electron`
 * itself, which is what lets this run under plain node with no Electron runtime.
 *
 * Run: node scripts/verifyUpdateEngine.cjs   (or npm run verify:update)
 */

const path = require('path');
const engine = require('../electron/lib/localUpdateEngine.cjs');

let pass = 0;
let fail = 0;

function check(label, ok, detail) {
  if (ok) {
    pass += 1;
    console.log(`  PASS  ${label}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${label}${detail ? ` - ${detail}` : ''}`);
  }
}

const { classifyChange, resolveTarget } = engine;

// ── Domains that already worked, asserted so they cannot regress ─────────────
console.log('\n--- the domains that already existed ---');

check('package.json is deps', classifyChange('package.json') === 'deps');
check('package-lock.json is deps', classifyChange('package-lock.json') === 'deps');
check('electron/main.cjs is main', classifyChange('electron/main.cjs') === 'main');
check('a nested electron file is main',
  classifyChange('electron/ipc/marketIntel.cjs') === 'main');
check('server/index.cjs is server', classifyChange('server/index.cjs') === 'server');
check('src is renderer', classifyChange('src/pages/StockMind/StockMind.jsx') === 'renderer');
check('shared is renderer', classifyChange('shared/capabilities.json') === 'renderer');
check('index.html is renderer', classifyChange('index.html') === 'renderer');
check('vite.config.js is renderer', classifyChange('vite.config.js') === 'renderer');
check('backslash paths are normalised',
  classifyChange('electron\\ipc\\aiProcess.cjs') === 'main',
  String(classifyChange('electron\\ipc\\aiProcess.cjs')));

// ── THE DEFECT (Section 80) ─────────────────────────────────────────────────
console.log('\n--- THE BLIND SPOT: ai_backend used to classify as null ---');

check('ai_backend/main.py is python',
  classifyChange('ai_backend/main.py') === 'python',
  String(classifyChange('ai_backend/main.py')));
check('a nested engine module is python',
  classifyChange('ai_backend/engine/projection.py') === 'python',
  String(classifyChange('ai_backend/engine/projection.py')));
check('an engine test is python',
  classifyChange('ai_backend/tests/test_ledger.py') === 'python');
check('IT IS NOT null any more — that omission is the whole defect',
  classifyChange('ai_backend/engine/ledger.py') !== null);
check('requirements.txt gets its OWN domain, so pip can run without a code change',
  classifyChange('ai_backend/requirements.txt') === 'pydeps',
  String(classifyChange('ai_backend/requirements.txt')));
check('requirements.txt is NOT lumped in with python',
  classifyChange('ai_backend/requirements.txt') !== 'python');
check('ai_backend deps do NOT classify as npm deps — a pip change must not trigger npm install',
  classifyChange('ai_backend/requirements.txt') !== 'deps');

console.log('\n--- paths that legitimately have no domain ---');
check('a doc is unclassified', classifyChange('RAMA_AGI_MASTER_SPEC.md') === null);
check('a script is unclassified', classifyChange('scripts/buildInstaller.cjs') === null);
check('a root dotfile is unclassified', classifyChange('.gitignore') === null);
check('an asset is unclassified', classifyChange('assets/icon.png') === null);
check('a path merely CONTAINING ai_backend is not python',
  classifyChange('docs/ai_backend-notes.md') === null,
  String(classifyChange('docs/ai_backend-notes.md')));

// ── Targeting: would this pull change the running code? ─────────────────────
console.log('\n--- a packaged install cannot self-update, and must say so ---');

const packaged = resolveTarget({
  repoPath: 'C:/clones/Rama_AGI',
  packaged: true,
  appPath: 'C:/Program Files/Rama AGI/resources/app.asar',
});
check('a packaged install reports packaged', packaged.packaged === true);
check('AND that it does not update the running instance',
  packaged.updatesRunningInstance === false);
check('the guidance names the setup file rather than a git error',
  /setup file/i.test(packaged.guidance || ''), packaged.guidance);
check('it names the rebuild command',
  /package:win/.test(packaged.guidance || ''), packaged.guidance);
check('it reassures that the data directory is untouched',
  /not touched/i.test(packaged.guidance || ''), packaged.guidance);

console.log('\n--- a source checkout that IS the running instance ---');

const repo = path.resolve('C:/clones/Rama_AGI');
const same = resolveTarget({ repoPath: repo, packaged: false, appPath: repo });
check('the repo being the app path updates the running instance',
  same.updatesRunningInstance === true, JSON.stringify(same));
check('and is not reported as packaged', same.packaged === false);
check('the guidance says so', /updates the code this instance runs from/.test(same.guidance || ''),
  same.guidance);

const nested = resolveTarget({
  repoPath: repo,
  packaged: false,
  appPath: path.join(repo, 'some', 'sub', 'dir'),
});
check('an app path INSIDE the repo also counts',
  nested.updatesRunningInstance === true, JSON.stringify(nested));

console.log('\n--- a checkout that is NOT the running instance ---');

const elsewhere = resolveTarget({
  repoPath: repo,
  packaged: false,
  appPath: path.resolve('C:/clones/SomeOtherApp'),
});
check('an unrelated app path does not update the running instance',
  elsewhere.updatesRunningInstance === false, JSON.stringify(elsewhere));
check('and the guidance says the running app is unaffected',
  /will not\s+change the running app/.test((elsewhere.guidance || '').replace(/\s+/g, ' ')),
  elsewhere.guidance);

const sibling = resolveTarget({
  repoPath: path.resolve('C:/clones/Rama'),
  packaged: false,
  appPath: path.resolve('C:/clones/Rama_AGI'),
});
check('A SIBLING WITH A PREFIX-MATCHING NAME IS NOT INSIDE — a string startsWith would say it is',
  sibling.updatesRunningInstance === false, JSON.stringify(sibling));

const noApp = resolveTarget({ repoPath: repo, packaged: false, appPath: null });
check('an unknown app path is treated as NOT updating the instance, the safe direction',
  noApp.updatesRunningInstance === false);
check('and says the answer is unknown', /unknown/i.test(noApp.guidance || ''), noApp.guidance);

// ── The interpreter used for pip ─────────────────────────────────────────────
console.log('\n--- pip goes through the same interpreter the backend runs under ---');

check('the python binary matches aiProcess\'s choice for this platform',
  engine.pythonBin === (process.platform === 'win32' ? 'python' : 'python3'),
  engine.pythonBin);

// ── The exported surface main.cjs depends on ────────────────────────────────
console.log('\n--- the exported surface ---');
for (const fn of ['checkForUpdates', 'pullBuildApply', 'classifyChange', 'resolveTarget']) {
  check(`${fn} is exported`, typeof engine[fn] === 'function', typeof engine[fn]);
}

// ── Argument guards ─────────────────────────────────────────────────────────
console.log('\n--- argument guards ---');
(async () => {
  const noPath = await engine.checkForUpdates(undefined, {});
  check('checkForUpdates with no repoPath refuses', noPath.ok === false);
  check('and says what was missing', /repoPath/.test(noPath.error || ''), noPath.error);
  const noPath2 = await engine.pullBuildApply({});
  check('pullBuildApply with no repoPath refuses', noPath2.ok === false);

  console.log(`\n${'='.repeat(62)}`);
  console.log(`  ${pass} passed, ${fail} failed`);
  console.log('='.repeat(62));
  process.exit(fail ? 1 : 0);
})();
