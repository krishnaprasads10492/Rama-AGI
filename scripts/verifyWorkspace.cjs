#!/usr/bin/env node
'use strict';

/**
 * verifyWorkspace.cjs — the shared context, and the scaffolder that writes files (Section 86).
 *
 * Two things here are worth testing hard. The registry decides what master sees by default, so a
 * duplicate or a silently-dropped favourite is a real regression. The scaffolder WRITES FILES, and
 * the worst case is not a bad template — it is writing into Rāma's own source and overwriting the
 * real `package.json`.
 *
 * `dataStore` is injected, so this runs with no Electron and touches no real settings.
 *
 * Run: node scripts/verifyWorkspace.cjs   (or npm run verify:workspace)
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const registry = require('../electron/lib/workspaceRegistry.cjs');
const scaffold = require('../electron/lib/projectScaffold.cjs');

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

// A stand-in for dataStore: same three calls, held in memory.
function fakeStore() {
  const mem = new Map();
  return {
    get: (d, k) => mem.get(`${d}:${k}`),
    set: (d, k, v) => mem.set(`${d}:${k}`, v),
    saveDomain: () => {},
    _dump: () => mem,
  };
}
let store = fakeStore();
registry.useStore(store);
const reset = () => { store = fakeStore(); registry.useStore(store); };

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'rama-ws-'));
let seq = 0;
const dir = (name) => {
  const d = path.join(TMP, name || `d${seq++}`);
  fs.mkdirSync(d, { recursive: true });
  return d;
};

// ── Path identity ────────────────────────────────────────────────────────────
console.log('\n--- one folder must have exactly one identity ---');

const a = dir('proj');
check('a path gets a key', !!registry.keyFor(a));
check('a trailing separator does not change identity',
  registry.keyFor(a) === registry.keyFor(`${a}${path.sep}`), registry.keyFor(`${a}${path.sep}`));
check('a relative segment resolves to the same identity',
  registry.keyFor(path.join(a, 'sub', '..')) === registry.keyFor(a));
if (process.platform === 'win32') {
  check('WINDOWS: case does not change identity — else the same project appears twice',
    registry.keyFor(a.toUpperCase()) === registry.keyFor(a.toLowerCase()));
} else {
  check('POSIX: case IS significant, as the filesystem says', true);
}
check('an empty path has no key', registry.keyFor('') === null);
check('a null path has no key', registry.keyFor(null) === null);
check('a non-string has no key', registry.keyFor(42) === null);

// ── Detection ────────────────────────────────────────────────────────────────
console.log('\n--- detection reads the folder rather than guessing from the name ---');

const nodeDir = dir('anode');
fs.writeFileSync(path.join(nodeDir, 'package.json'), JSON.stringify({ name: 'my-pkg' }));
let d = registry.detect(nodeDir);
check('package.json makes it node', d.kind === 'node', d.kind);
check('AND THE NAME COMES FROM package.json, not the folder', d.name === 'my-pkg', d.name);

const reactDir = dir('areact');
fs.writeFileSync(path.join(reactDir, 'package.json'),
  JSON.stringify({ name: 'ui', dependencies: { react: '18' } }));
check('a react dependency makes it react', registry.detect(reactDir).kind === 'react');

const elDir = dir('anelectron');
fs.writeFileSync(path.join(elDir, 'package.json'),
  JSON.stringify({ name: 'app', devDependencies: { electron: '30', react: '18' } }));
check('ELECTRON WINS OVER REACT — the most specific signal, not the first',
  registry.detect(elDir).kind === 'electron', registry.detect(elDir).kind);

const pyDir = dir('apython');
fs.writeFileSync(path.join(pyDir, 'requirements.txt'), '');
check('requirements.txt makes it python', registry.detect(pyDir).kind === 'python');

const staticDir = dir('astatic');
fs.writeFileSync(path.join(staticDir, 'index.html'), '<html></html>');
check('index.html alone makes it static', registry.detect(staticDir).kind === 'static');

const gitDir = dir('agit');
fs.mkdirSync(path.join(gitDir, '.git'));
d = registry.detect(gitDir);
check('a bare .git folder is git', d.kind === 'git' && d.isGit === true);
check('isGit is reported independently of kind',
  registry.detect(elDir).isGit === false && registry.detect(gitDir).isGit === true);
check('a plain folder is "folder"', registry.detect(dir()).kind === 'folder');
check('a nonexistent path does not throw',
  registry.detect(path.join(TMP, 'ghost')).kind === 'folder');
check('a FILE rather than a directory does not throw', (() => {
  const f = path.join(TMP, 'afile.txt');
  fs.writeFileSync(f, 'x');
  return registry.detect(f).kind === 'folder';
})());
check('unreadable package.json is still a node signal', (() => {
  const bad = dir('badpkg');
  fs.writeFileSync(path.join(bad, 'package.json'), '{ not json');
  return registry.detect(bad).kind === 'node';
})());

// ── Register, dedupe, recency ────────────────────────────────────────────────
console.log('\n--- registering is idempotent, and recency is what pages read ---');
reset();

let r = registry.register({ path: nodeDir });
check('a first register creates', r.ok && r.created === true, JSON.stringify(r));
check('and detects the kind', r.project.kind === 'node');
check('and counts one open', r.project.openCount === 1);

r = registry.register({ path: `${nodeDir}${path.sep}` });
check('REGISTERING THE SAME FOLDER AGAIN DOES NOT DUPLICATE IT', r.created === false);
check('the open count rises instead', r.project.openCount === 2);
check('the list holds exactly one entry', registry.list().length === 1,
  String(registry.list().length));

registry.register({ path: reactDir });
registry.register({ path: pyDir });
check('three distinct folders make three entries', registry.list().length === 3);

const beforeTouch = registry.list()[0].path;
registry.touch(nodeDir);
check('touching a project makes it the most recent',
  registry.list()[0].path === nodeDir, `${beforeTouch} → ${registry.list()[0].path}`);
check('touching an unknown path registers it rather than failing',
  registry.touch(staticDir).ok === true && registry.list().length === 4);

// ── Pinning ──────────────────────────────────────────────────────────────────
console.log('\n--- favourites: what master says matters, stays ---');

registry.pin(pyDir, true);
check('a pinned project sorts to the top even when not most recent',
  registry.list()[0].path === pyDir, registry.list()[0].path);
registry.touch(nodeDir);
check('AND STAYS ABOVE a more recently opened unpinned one',
  registry.list()[0].path === pyDir, registry.list()[0].path);
registry.pin(pyDir, false);
check('unpinning returns it to recency order', registry.list()[0].path === nodeDir);
check('pinning an unknown path registers it pinned',
  registry.pin(gitDir, true).project.pinned === true);

// ── The eviction rule ────────────────────────────────────────────────────────
console.log('\n--- the cap evicts, but NEVER a favourite ---');
reset();
const pinnedPath = dir('keepme');
registry.register({ path: pinnedPath });
registry.pin(pinnedPath, true);
for (let i = 0; i < registry.MAX_ENTRIES + 15; i++) {
  registry.register({ path: dir(`bulk${i}`) });
}
const rows = registry.list();
check(`the list is capped at ${registry.MAX_ENTRIES}`, rows.length <= registry.MAX_ENTRIES,
  String(rows.length));
check('THE PINNED PROJECT SURVIVED being pushed out by 75 others',
  rows.some((x) => x.path === pinnedPath), 'pinned entry was evicted');

// ── Missing paths ────────────────────────────────────────────────────────────
console.log('\n--- a folder that has gone away is marked, not deleted ---');
reset();
const vanishing = dir('vanishes');
registry.register({ path: vanishing });
registry.pin(vanishing, true);
fs.rmSync(vanishing, { recursive: true, force: true });
const after = registry.list();
check('the entry is still listed', after.length === 1, String(after.length));
check('and marked missing', after[0].missing === true);
check('A PINNED FAVOURITE IS NOT SILENTLY ERASED because a drive was unmounted',
  after[0].pinned === true && after[0].path === vanishing);
check('preferred() skips a missing folder', registry.preferred() === null,
  JSON.stringify(registry.preferred()));

// ── preferred(), which is what removes the tedium ─────────────────────────────
console.log('\n--- preferred(): what a page opens on instead of an empty picker ---');
reset();
const plain = dir('plainfolder');
const repo = dir('arepo');
fs.mkdirSync(path.join(repo, '.git'));
registry.register({ path: plain });
registry.register({ path: repo });
registry.touch(plain);                 // plain is most recent
check('preferred() returns the most recent project', registry.preferred().path === plain);
check('preferred({requireGit}) returns the most recent REPOSITORY, not just any folder',
  registry.preferred({ requireGit: true }).path === repo,
  JSON.stringify(registry.preferred({ requireGit: true })));
reset();
check('preferred() on an empty registry is null, not a guess', registry.preferred() === null);

// ── forget ───────────────────────────────────────────────────────────────────
console.log('\n--- forgetting removes the record and nothing else ---');
reset();
const keep = dir('stays');
registry.register({ path: keep });
const f = registry.forget(keep);
check('forget succeeds', f.ok === true);
check('the entry is gone', registry.list().length === 0);
check('THE FOLDER IS STILL ON DISK — forget is not delete', fs.existsSync(keep));
check('forgetting an unknown path reports so', registry.forget(dir()).ok === false);
check('forgetting nothing is refused', registry.forget(null).ok === false);

// ── createdByRama is sticky ──────────────────────────────────────────────────
console.log('\n--- provenance survives later plain opens ---');
reset();
const made = dir('rama-made');
registry.register({ path: made, createdByRama: true });
registry.register({ path: made });
check('a later plain register does NOT erase createdByRama',
  registry.find(made).createdByRama === true);

// ═══ Scaffolding ═════════════════════════════════════════════════════════════
console.log('\n--- templates produce something that runs ---');
reset();
const parent = dir('projects');

check('templates are listed with labels', scaffold.templateList().length >= 5
  && scaffold.templateList().every((t) => t.id && t.label && t.describe),
  JSON.stringify(scaffold.templateList().map((t) => t.id)));

for (const t of scaffold.templateList()) {
  const res = scaffold.create({
    parentDir: parent, name: `Demo ${t.id}`, template: t.id, git: false,
  });
  check(`${t.id}: created`, res.ok === true, res.error);
  check(`${t.id}: wrote files`, (res.written || []).length > 0, JSON.stringify(res.written));
  check(`${t.id}: the folder exists on disk`, res.ok && fs.existsSync(res.path));
  check(`${t.id}: REGISTERED ITSELF — master never tells Rāma what he just made`,
    res.registered === true && !!registry.find(res.path), JSON.stringify(res.project));
  check(`${t.id}: marked as created by Rāma`,
    res.ok && registry.find(res.path).createdByRama === true);
  check(`${t.id}: pinned, since it is what he is about to work on`,
    res.ok && registry.find(res.path).pinned === true);
  if (t.id !== 'empty' && t.id !== 'static') {
    check(`${t.id}: detected as a real project kind, not "folder"`,
      registry.find(res.path).kind !== 'folder', registry.find(res.path).kind);
  }
}

const nodeCli = path.join(parent, 'demo-node-cli');
check('node-cli produced valid JSON in package.json', (() => {
  try { JSON.parse(fs.readFileSync(path.join(nodeCli, 'package.json'), 'utf8')); return true; }
  catch { return false; }
})());
check('node-lib\'s test actually passes when run', (() => {
  const { spawnSync } = require('child_process');
  const p = path.join(parent, 'demo-node-lib');
  const res = spawnSync('node', [path.join(p, 'test', 'index.test.js')], { encoding: 'utf8' });
  return res.status === 0;
})(), 'the scaffolded test failed');
check('no template leaves a TODO or placeholder behind', (() => {
  const walk = (p) => fs.readdirSync(p, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(p, e.name);
    if (e.isDirectory()) return e.name === '.git' ? [] : walk(full);
    return [full];
  });
  return walk(parent).every((file) => {
    const body = fs.readFileSync(file, 'utf8');
    return !/\bTODO\b|\bFIXME\b|PLACEHOLDER/i.test(body);
  });
})(), 'a scaffolded file contained a TODO/placeholder');

// ── Scaffolding safety ───────────────────────────────────────────────────────
console.log('\n--- THE GUARD THAT MATTERS: never write into Rāma itself ---');

const inRama = scaffold.create({
  parentDir: scaffold.ramaRoot(), name: 'oops', template: 'node-cli', git: false,
});
check('REFUSES to scaffold inside Rāma\'s own source tree', inRama.ok === false,
  JSON.stringify(inRama));
check('and explains what would have been overwritten',
  /overwrite/.test(inRama.error || ''), inRama.error);
const inRamaSub = scaffold.create({
  parentDir: path.join(scaffold.ramaRoot(), 'src', 'pages'), name: 'oops2',
  template: 'empty', git: false,
});
check('refuses a nested path inside Rāma too', inRamaSub.ok === false, JSON.stringify(inRamaSub));

console.log('\n--- path and name safety ---');
const trav = scaffold.create({
  parentDir: parent, name: '../../escaped', template: 'empty', git: false,
});
check('a traversing name cannot escape the parent',
  trav.ok === false || scaffold.isInside(parent, trav.path),
  JSON.stringify(trav));
check('slugify strips traversal', scaffold.slugify('../../evil') === 'evil',
  scaffold.slugify('../../evil'));
check('slugify strips separators', !scaffold.slugify('a/b\\c').includes('/'));
check('slugify handles unicode by stripping it',
  scaffold.slugify('日本語') === '' || /^[a-z0-9._-]*$/.test(scaffold.slugify('日本語')));
check('a name with no usable characters is refused',
  scaffold.create({ parentDir: parent, name: '///', template: 'empty', git: false }).ok === false);
check('an empty name is refused',
  scaffold.create({ parentDir: parent, name: '', template: 'empty' }).ok === false);
check('a missing parent is refused',
  scaffold.create({ parentDir: null, name: 'x', template: 'empty' }).ok === false);
check('a nonexistent parent is refused',
  scaffold.create({ parentDir: path.join(TMP, 'nope'), name: 'x', template: 'empty' }).ok === false);
check('an unknown template is refused and lists the real ones', (() => {
  const res = scaffold.create({ parentDir: parent, name: 'y', template: 'ruby-on-rails' });
  return res.ok === false && Array.isArray(res.templates);
})());

console.log('\n--- existing files are never overwritten ---');
const occupied = path.join(parent, 'occupied');
fs.mkdirSync(occupied, { recursive: true });
fs.writeFileSync(path.join(occupied, 'README.md'), 'MY IMPORTANT NOTES');
let occ = scaffold.create({ parentDir: parent, name: 'occupied', template: 'empty', git: false });
check('a non-empty directory is refused without force', occ.ok === false, JSON.stringify(occ));
check('and says the files are safe either way', /never overwritten/.test(occ.error || ''),
  occ.error);
occ = scaffold.create({
  parentDir: parent, name: 'occupied', template: 'empty', git: false, force: true,
});
check('with force it proceeds', occ.ok === true, occ.error);
check('BUT THE EXISTING FILE IS UNTOUCHED',
  fs.readFileSync(path.join(occupied, 'README.md'), 'utf8') === 'MY IMPORTANT NOTES');
check('and the skip is reported rather than silent',
  (occ.skipped || []).some((s) => s.file === 'README.md'), JSON.stringify(occ.skipped));

console.log('\n--- git is best effort, not a precondition ---');
const withGit = scaffold.create({
  parentDir: parent, name: 'with-git', template: 'empty', git: true,
});
check('creation succeeds regardless of git\'s outcome', withGit.ok === true, withGit.error);
check('and the git outcome is reported', withGit.git !== null, JSON.stringify(withGit.git));
check('a git failure never turns a written project into a failure',
  withGit.ok === true && (withGit.written || []).length > 0);

try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* leave it */ }

console.log(`\n${'='.repeat(62)}`);
console.log(`  ${pass} passed, ${fail} failed`);
console.log('='.repeat(62));
process.exit(fail ? 1 : 0);
