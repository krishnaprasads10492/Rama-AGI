#!/usr/bin/env node
/**
 * verifyUiHealth.mjs — what the startup-diagnosis panel may say (spec Section 187)
 *
 * THE FAILURE GUARDED HERE IS A MISREADING, not a crash. `startupDoctor` marks a degradation
 * `expected` when the build manifest recorded that the module could not be compiled; render that
 * beside a real fault in the same colour and master goes hunting a bug that does not exist. The
 * opposite mistake is worse: a build with NO manifest cannot tell the two apart at all, and a panel
 * that stays quiet about that is claiming a distinction it cannot make.
 *
 * So every sentence is made by `src/pages/System/healthModel.js` and driven here with awkward
 * input, and the component is read as source for what a render cannot show: that it reads on mount
 * but never REPAIRS on mount, that the repair's limit is stated before the button, and that the
 * word "healthy" is never printed.
 *
 * Run: node scripts/verifyUiHealth.mjs   (or npm run verify:ui-health)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as M from '../src/pages/System/healthModel.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0;
let fail = 0;
const check = (label, ok, detail) => {
  if (ok) { pass += 1; console.log(`  PASS  ${label}`); }
  else { fail += 1; console.log(`  FAIL  ${label}${detail ? ` - ${detail}` : ''}`); }
};
const section = (t) => console.log(`\n--- ${t} ---`);
const strings = (v, out = []) => {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => strings(x, out));
  return out;
};
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const codeOnly = (src) => src
  // Line comments first, then blocks, and no `$` anchor — this repository is CRLF and `.` does not
  // match `\r`, which made an earlier stripper silently strip nothing (Section 183.4).
  .split('\n').map((l) => l.replace(/(^|\s)\/\/.*/, '')).join('\n')
  .replace(/\/\*[\s\S]*?\*\//g, ' ');

// ─── Fixtures: the real `health:startup` shape ───────────────────────────────────────────────────
const manifest = (over = {}) => ({
  version: '1.0.0',
  builtAt: '2026-11-06T09:00:00.000Z',
  builtOn: 'win32-x64',
  nodeAtBuild: '26.13.0',
  readiness: { verdict: 'ready-with-limits', degraded: [] },
  nativeModules: {
    rebuilt: false,
    error: 'MSB8040',
    degraded: ['argon2', 'node-pty'],
    consequences: ['node-pty did not compile. The terminal is DISABLED.'],
  },
  ...over,
});

const payload = (over = {}) => ({
  ok: true,
  data: {
    healthy: true,
    fatal: [],
    degraded: [],
    checks: [
      { label: 'express', pass: true, note: '' },
      { label: 'node-pty', pass: false, note: 'installed but its native binding was never built' },
    ],
    previousCrash: null,
    buildManifest: manifest(),
    packaged: true,
    registrationFailures: [],
    repair: null,
    ...over,
  },
});

// ─── Three nothings ─────────────────────────────────────────────────────────────────────────────
section('not asked, refused, and never ran are three different things');
{
  const idle = M.state(null);
  const notRun = M.state({ ok: false, error: 'Startup diagnosis has not run yet' });
  const failed = M.state({ ok: false, error: 'the bridge is absent' });
  const ready = M.state(payload());

  check('three distinct kinds plus ready',
    new Set([idle.kind, notRun.kind, failed.kind, ready.kind]).size === 4,
    [idle.kind, notRun.kind, failed.kind, ready.kind].join(','));
  check('not-yet-read says so rather than implying nothing is wrong',
    /Not read yet/.test(idle.title) && !/healthy|no faults/i.test(idle.title));
  // THE DISTINCTION THAT MATTERS: the main process answers "has not run yet" very early in a
  // launch, which is not the same as a channel that is broken.
  check('"has not run yet" is its own kind, not a failure', notRun.kind === 'not-run');
  check('and it explains WHEN that is expected', /once at startup/.test(notRun.detail));
  check('a genuine refusal is a failure with its reason', failed.kind === 'failed' && /bridge is absent/.test(failed.detail));
  check('a refusal with no reason still says something', /No reason was reported/.test(M.state({ ok: false }).detail));
  check('idle and failed produce no counts', M.oneLine(null) === 'Not read yet'
    && /could not be read/.test(M.oneLine({ ok: false, error: 'x' })));
}

// ─── Expected is not damage ─────────────────────────────────────────────────────────────────────
section('a degradation the build expected is not a fault in this installation');
{
  const p = payload({
    degraded: [
      { id: 'native-node-pty', module: 'node-pty', detail: 'node-pty did not compile — the terminal is DISABLED', expected: true, fetchable: false, remedy: 'install the Spectre libs' },
      { id: 'dep-vectra', module: 'vectra', detail: 'vectra absent — vector memory', remedy: 'npm install vectra' },
    ],
    fatal: [{ id: 'dep-express', module: 'express', detail: 'express is missing — the local API cannot run', remedy: 'Rāma will fetch it' }],
  });
  const h = M.headline(p);
  check('the three counts are kept apart', h.fatal === 1 && h.unexpected === 1 && h.expected === 1,
    JSON.stringify([h.fatal, h.unexpected, h.expected]));

  const r = M.rows(p);
  check('fatal sorts first, then unexpected, then expected',
    r.map((x) => x.cls).join(',') === 'fatal,unexpected,expected', r.map((x) => x.cls).join(','));
  check('an expected row is LABELLED as known at build time, not just flagged',
    /known at build time, not a fault here/.test(r[2].label));
  check('and an unexpected one is not given that excuse', !/known at build/.test(r[1].label));
  check('a fatal row says it stops a feature working', /stops a feature working/.test(r[0].label));
  check('every row carries its detail', r.every((x) => typeof x.detail === 'string' && x.detail.length > 0));
  check('a row with no detail still says something rather than rendering blank',
    /No detail was reported/.test(M.rows(payload({ fatal: [{ id: 'x' }] }))[0].detail));
  check('the remedy travels with the row', r[0].remedy === 'Rāma will fetch it');

  // Section 183.6 carried into the UI.
  check('a module a repair cannot fix is marked on the ROW, not only beside the button',
    r.find((x) => x.module === 'node-pty').fetchable === false);
  check('and a fetchable one is not marked unfixable',
    M.rows(p).find((x) => x.module === 'vectra').fetchable === null);

  check('the verdict names faults when there are any', /faults that stop features working/.test(h.verdict));
  check('with no faults but unexpected degradation it does not say all is well',
    /did not expect/.test(M.headline(payload({ degraded: [{ id: 'a', detail: 'b' }] })).verdict));
  check('and a clean one says "no faults found", never "healthy"',
    M.headline(payload()).verdict === 'no faults found');
}

// ─── A build with no manifest cannot tell the difference, and says so ───────────────────────────
section('without a build manifest the panel admits what it cannot distinguish');
{
  const withM = M.headline(payload());
  const withoutM = M.headline(payload({ buildManifest: null }));
  check('the manifest presence is reported', withM.manifestPresent === true && withoutM.manifestPresent === false);
  check('with a manifest the caveat is about unchecked things',
    /does not check would not appear here/.test(withM.caveat));
  // THE IMPORTANT ONE. No manifest means `expected` can never be set, so every trade-off reads as
  // damage — and a panel that stays quiet about that is claiming a distinction it cannot make.
  check('WITHOUT one it says a trade-off cannot be told from a fault',
    /cannot be told apart from an accepted build-time trade-off/.test(withoutM.caveat));
  check('and says which way the error falls', /reads as a fault whether it is one or not/.test(withoutM.caveat));
  check('the build block is null rather than invented when absent', M.build(payload({ buildManifest: null })) === null);

  const b = M.build(payload());
  check('the build block reports what the build recorded', b.version === '1.0.0' && b.builtOn === 'win32-x64');
  check('the date is shortened for reading, not dropped', b.builtAt === '2026-11-06');
  check('the native-rebuild outcome Section 178 recorded is surfaced at last',
    b.nativeRebuilt === false && b.nativeDegraded.join(',') === 'argon2,node-pty');
  check('with its consequences', b.nativeConsequences.length === 1 && /DISABLED/.test(b.nativeConsequences[0]));
  check('a build that did not record the outcome is UNKNOWN, not fine', (() => {
    const u = M.build(payload({ buildManifest: manifest({ nativeModules: { rebuilt: null, degraded: [], consequences: [] } }) }));
    return u.nativeRebuilt === null;
  })());
  check('and a manifest with no nativeModules block at all is unknown too', (() => {
    const m = manifest(); delete m.nativeModules;
    return M.build(payload({ buildManifest: m })).nativeRebuilt === null;
  })());
}

// ─── The repair states its limit before it is used ──────────────────────────────────────────────
section('the repair button says what it cannot do, before it is pressed');
{
  const p = payload({ degraded: [{ id: 'native-argon2', module: 'argon2', detail: 'argon2 did not compile', fetchable: false }] });
  const r = M.repair(p);
  check('it says what a repair does', /fetches packages/.test(r.can) && /verifies their checksums/.test(r.can));
  check('and that it cannot compile anything', /cannot compile anything/.test(r.cannot));
  check('it names the modules this particular repair will not fix', r.unfixable.join(',') === 'argon2');
  check('with a sentence a reader can act on', /argon2 will not be fixed by this/.test(r.unfixableNote));
  check('and the singular reads correctly', /it needs a compiler/.test(r.unfixableNote));
  check('two unfixable modules read as plural', (() => {
    const two = M.repair(payload({ degraded: [
      { id: 'a', module: 'argon2', detail: 'x', fetchable: false },
      { id: 'b', module: 'node-pty', detail: 'y', fetchable: false },
    ] }));
    return /they need a compiler/.test(two.unfixableNote);
  })());
  check('nothing unfixable means no invented warning', M.repair(payload()).unfixableNote === null);
  check('no previous repair is null, not an empty success', M.repair(payload()).last === null);

  const after = M.repair(payload({ repair: { attempted: ['debug'], repaired: ['debug'], recovered: ['sysinfo'], remaining: [], notes: ['argon2 needs a compiler — skipped'] } }));
  check('a previous repair is reported with all four lists',
    after.last.attempted.length === 1 && after.last.repaired.length === 1
    && after.last.recovered.length === 1 && after.last.remaining.length === 0);
  check('and its notes are carried, which is where the skip reasons live',
    /needs a compiler/.test(after.last.notes[0]));
}

// ─── The rest of the payload ────────────────────────────────────────────────────────────────────
section('the crash, the check list, and the channels that never registered');
{
  const crash = M.lastCrash(payload({ previousCrash: { message: 'Cannot find module debug', at: '2026-11-05T10:00:00Z' } }));
  check('a previous crash is surfaced', /Cannot find module debug/.test(crash.message));
  check('and labelled as the PREVIOUS run, so nobody hunts a current one',
    /killed the previous launch/.test(crash.note) && /not necessarily still happening/.test(crash.note));
  check('no crash is null rather than an empty card', M.lastCrash(payload()) === null);
  check('a crash with no message still says something', /No message was recorded/.test(M.lastCrash(payload({ previousCrash: {} })).message));

  const list = M.checks(payload());
  check('the check list is carried', list.length === 2);
  check('a failing check keeps its note, which is where the real sentence is',
    list.find((c) => c.label === 'node-pty').note === 'installed but its native binding was never built');
  check('pass is a strict boolean, so a missing field is not a pass',
    M.checks(payload({ checks: [{ label: 'x' }] }))[0].pass === false);
  check('an unnamed check does not render blank', /unnamed/.test(M.checks(payload({ checks: [{ pass: true }] }))[0].label));

  const dead = M.unregistered(payload({ registrationFailures: [{ label: 'Market intelligence', error: 'boom' }] }));
  check('a subsystem that never registered is named', dead[0].label === 'Market intelligence' && dead[0].error === 'boom');
  check('with no failures the list is empty rather than absent', Array.isArray(M.unregistered(payload())));
  check('a failure with no reason still reports one', /No reason was reported/.test(M.unregistered(payload({ registrationFailures: [{ label: 'x' }] }))[0].error));
}

// ─── claimGate: the word healthy is never used ──────────────────────────────────────────────────
section('claimGate: no "healthy", no score, no all-clear');
{
  const BANNED = ['healthy', 'health y', 'score', 'grade', 'secure', 'safe', 'all clear', 'all good', 'perfect', 'optimal'];
  const everything = [null, { ok: false, error: 'x' }, { ok: true, data: {} }, payload(),
    payload({ buildManifest: null })]
    .flatMap((p) => [M.state(p), M.headline(p), M.build(p), M.rows(p), M.checks(p),
      M.lastCrash(p), M.repair(p), M.unregistered(p), M.oneLine(p)])
    .flatMap((v) => strings(v));
  for (const w of BANNED) {
    const hits = everything.filter((s) => new RegExp(`\\b${w}\\b`, 'i').test(s));
    check(`nothing claims "${w}"`, hits.length === 0, hits.join(' | '));
  }
  check('no percentage is reported', !everything.some((s) => /\d\s?%/.test(s)));
  check('the model exports no scoring function',
    !Object.keys(M).some((k) => /score|grade|rate|rank/i.test(k)), Object.keys(M).join(','));
  check('a clean diagnosis is phrased as "no faults FOUND"', /no faults found/.test(M.oneLine(payload())));
  check('and says across how many checks, so the claim is bounded',
    /across 2 checks/.test(M.oneLine(payload())), M.oneLine(payload()));
}

// ─── Hostile input ──────────────────────────────────────────────────────────────────────────────
section('hostile input produces a sentence, never an exception');
{
  const hostile = [undefined, null, 0, '', false, [], {}, { ok: true }, { ok: true, data: null },
    { ok: true, data: { fatal: null, degraded: 'nope', checks: 7 } },
    { ok: true, data: { degraded: [null, undefined] } },
    { ok: true, data: { buildManifest: {} } },
    { ok: true, data: { registrationFailures: 'no' } },
    { ok: true, data: { repair: {} } }];
  let threw = null;
  for (const h of hostile) {
    try {
      M.state(h); M.headline(h); M.build(h); M.rows(h); M.checks(h);
      M.lastCrash(h); M.repair(h); M.unregistered(h); M.oneLine(h);
    } catch (err) { threw = `${JSON.stringify(h)}: ${err.message}`; break; }
  }
  check('fourteen malformed payloads, no throw', threw === null, threw);
  check('a null entry in degraded does not become a blank row',
    M.rows({ ok: true, data: { degraded: [null, { id: 'a', detail: 'b' }] } }).length === 1);
  check('an absent check list yields null counts, not zero',
    M.headline({ ok: true, data: {} }).checksRun === null
    && M.headline({ ok: true, data: {} }).checksPassed === null);
  check('and the one-line form shows a dash for an unmeasured count',
    /across — checks/.test(M.oneLine({ ok: true, data: {} })), M.oneLine({ ok: true, data: {} }));
  check('a negative limit cannot wrap into a full list', M.rows(payload({ fatal: [{ id: 'a', detail: 'b' }] }), { limit: -1 }).length === 0);
}

// ─── The component ──────────────────────────────────────────────────────────────────────────────
section('the panel itself');
{
  const panelPath = path.join(ROOT, 'src', 'pages', 'System', 'HealthPanel.jsx');
  check('the panel exists', fs.existsSync(panelPath), panelPath);
  const code = fs.existsSync(panelPath) ? fs.readFileSync(panelPath, 'utf8') : '';
  const bare = codeOnly(code);

  check('it imports the model rather than composing its own sentences',
    /from '\.\/healthModel(\.js)?'/.test(code));
  check('it calls the real bridge channel', /window\.rama\?\.health\?\.startup/.test(code));

  // READ ON MOUNT IS CORRECT HERE, and the reason is cost: this is one cheap read of a value the
  // main process already computed. The security panel shells out to npm audit, which is why THAT
  // one is a button. The distinction is worth asserting so neither drifts into the other's shape.
  check('it reads the diagnosis on mount, since the read is free',
    /useEffect\(\(\) => \{ read\(\); \}, \[read\]\)/.test(code));
  check('but it never REPAIRS on mount', !/useEffect\([^}]*runRepair\(\)/.test(bare));
  check('repair is behind an explicit button', /onClick=\{runRepair\}/.test(code));
  check('and the button is disabled until there is a diagnosis to repair against',
    /disabled=\{busy \|\| s\.kind !== 'ready'\}/.test(code));
  check('after repairing it re-reads rather than trusting the repair\u2019s own return',
    /await read\(\);/.test(code));

  check('no console.log in shipped renderer code', !/console\.log\(/.test(code));
  check('the repair limit is rendered BEFORE the result, not after a failure',
    code.indexOf('rep.cannot') > 0 && code.indexOf('rep.cannot') < code.indexOf('rep.last'));
  check('the unfixable note is rendered', /rep\.unfixableNote/.test(code));
  check('the per-row "a repair cannot fix this" is rendered too',
    /needs a compiler, not a download/.test(code));
  check('the manifest caveat is rendered', /\{h\.caveat\}/.test(code));
  check('the previous crash is rendered', /crash\.message/.test(code));
  check('the unregistered channels are rendered', /dead\.map/.test(code));
  check('the check list is rendered behind a toggle, not dumped',
    /showChecks/.test(code) && /list\.map/.test(code));
  check('the native consequences from the manifest are rendered',
    /b\.nativeConsequences\.map/.test(code));
  check('an unknown native outcome is rendered as unknown',
    /b\.nativeRebuilt === null/.test(code) && /unknown rather than fine/.test(code));

  // The markup must not claim what the model refuses to.
  for (const w of ['healthy', 'all clear', 'secure', 'score']) {
    const between = bare.match(new RegExp(`>[^<>{]*\\b${w}\\b[^<>}]*<`, 'gi')) || [];
    const quoted = bare.match(new RegExp(`['"\`][^'"\`]*\\b${w}\\b[^'"\`]*['"\`]`, 'gi')) || [];
    check(`the markup never claims "${w}"`, between.length === 0 && quoted.length === 0,
      [...between, ...quoted].join(' | '));
  }

  const sys = read('src/pages/System/System.jsx');
  check('the System page imports the panel with a real import statement',
    /import HealthPanel from '\.\/HealthPanel\.jsx'/.test(sys));
  check('and renders it', /<HealthPanel\s*\/?>/.test(sys));
  check('before the dependency panel, since a fault here outranks an advisory there',
    sys.indexOf('<HealthPanel') < sys.indexOf('<SecurityPanel'));
}

console.log(`\n${'='.repeat(62)}`);
console.log(`  ${pass} passed, ${fail} failed`);
console.log('='.repeat(62));
process.exit(fail === 0 ? 0 : 1);
