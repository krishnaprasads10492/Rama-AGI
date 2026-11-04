'use strict';

/**
 * verifyNativeFacts.cjs — the claim about a failed native build is true, and said once
 * (spec Section 183)
 *
 * WHAT WENT WRONG, MEASURED. The same sentence about node-pty was written three times and was false
 * in all three: `beforeBuild.cjs` printed "argon2 falls back to scrypt, node-pty to a piped shell —
 * both work, both weaker"; `buildInstaller.cjs`'s `nativeDegradations()` said "the terminal is a
 * piped shell rather than a real pty"; `startupDoctor.cjs` listed node-pty as "a real terminal
 * (falls back to a piped shell)". There is no piped shell in this codebase. The terminal is
 * disabled, every command returns "Command not executed", and master read "both work" off his own
 * build log while holding an installer whose terminal does nothing.
 *
 * Two defects, both guarded here:
 *   1. THE WORDS WERE WRONG, and a check in `verifyReadinessReport.cjs` PINNED them — it asserted
 *      `/piped shell/`, so the suite would have defended the false claim against a correction.
 *   2. THE CLAIM WAS DUPLICATED, which is how one copy goes false without the others noticing.
 *
 * And one more the first defect hid: `startupDoctor` probed these modules with `require.resolve`,
 * which succeeds for a package whose binding was never compiled — so it reported node-pty PRESENT
 * on exactly the machine where the terminal was dead.
 *
 * Run: node scripts/verifyNativeFacts.cjs   (or npm run verify:native-facts)
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const facts = require('../shared/nativeModuleFacts.cjs');
const doctor = require('../electron/lib/startupDoctor.cjs');

let pass = 0;
let fail = 0;
const check = (label, ok, detail) => {
  if (ok) { pass += 1; console.log(`  PASS  ${label}`); }
  else { fail += 1; console.log(`  FAIL  ${label}${detail ? ` - ${detail}` : ''}`); }
};
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/**
 * Source with comments removed.
 *
 * The ban on "piped shell" is a ban on SAYING it to master, not on recording that it was once said
 * wrongly. Each of these files now carries a comment naming the false claim so the correction is
 * legible to the next reader, and a check that could not tell the two apart would force the history
 * to be deleted in order to pass — which is the opposite of what this suite is for.
 *
 * LINE COMMENTS FIRST, THEN BLOCKS, and the order is load-bearing. Stripping block comments first
 * pairs the first opener with the next closer, so a line comment that happens to contain an opener
 * starts a span that swallows real code and spits the rest of a comment back out — measured: two of
 * these files still reported "piped shell" from inside a comment that had supposedly been removed.
 * Taking line comments out first means no fake opener survives to pair with anything.
 *
 * AND NO `$` ANCHOR, which cost two more passes to find. This repository is CRLF, so splitting on
 * `\n` leaves a `\r` at the end of every line; `.` does not match `\r` because it is a line
 * terminator, so `//.*$` could never reach the end of the string and matched NOTHING. The strip
 * silently did nothing at all and the check reported the comments it was meant to ignore.
 */
const codeOnly = (src) => src
  .split('\n')
  .map((l) => l.replace(/(^|\s)\/\/.*/, ''))
  .join('\n')
  .replace(/\/\*[\s\S]*?\*\//g, ' ');

const section = (t) => console.log(`\n--- ${t} ---`);

const FACTS_FILE = 'shared/nativeModuleFacts.cjs';
const CONSUMERS = ['scripts/beforeBuild.cjs', 'scripts/buildInstaller.cjs',
  'electron/lib/startupDoctor.cjs', 'electron/ipc/terminal.cjs'];

// ─── The claim itself ────────────────────────────────────────────────────────────────────────────
section('the claim about node-pty is the true one');
{
  const all = facts.consequences().join(' ');
  const pty = facts.NATIVE_MODULES.find((m) => m.name === 'node-pty');
  const argon = facts.NATIVE_MODULES.find((m) => m.name === 'argon2');

  check('node-pty is declared as NOT degrading gracefully', pty && pty.degrades === false);
  check('and its consequence says the terminal is disabled', /DISABLED|disabled/.test(pty.whenMissing));
  check('and says plainly that no command runs', /no command runs/i.test(pty.whenMissing));
  // THE FALSE CLAIM, BANNED BY NAME. It survived two tranches and a verify check defended it.
  check('"piped shell" appears nowhere in the consequences', !/piped shell/i.test(all), all);
  check('nor does "both work"', !/both work/i.test(all));
  check('nor is node-pty called merely weaker', !/node-pty[^.]*weaker/i.test(all));

  check('argon2 IS declared as degrading, because it genuinely does', argon && argon.degrades === true);
  check('and its consequence names scrypt and keeps the encryption claim accurate',
    /scrypt/.test(argon.whenMissing) && /AES-256-GCM/.test(argon.whenMissing));
  check('and does not overstate it either — the vault still works', !/disabled|unusable/i.test(argon.whenMissing));

  // Worst first: a reader who stops after one line must have been told the bigger thing.
  check('the module that stops working entirely is listed BEFORE the one that falls back',
    facts.consequences()[0].startsWith('node-pty'), facts.consequences()[0]);
  check('every consequence names its module', facts.consequences().every((c) => /^(argon2|node-pty) /.test(c)));
  check('the one-line summary does not claim anything still works',
    !/both work/i.test(facts.summaryLine()) && /stops working entirely/.test(facts.summaryLine()),
    facts.summaryLine());
  check('and its verb agrees with its subject count', !/\b(node-pty|argon2) (stop|fall) \b/.test(facts.summaryLine()),
    facts.summaryLine());
}

// ─── The remedy is something master can run ──────────────────────────────────────────────────────
section('a remedy is a command where a command exists (Section 176\u2019s ruling)');
{
  const lines = facts.remedyLines();
  const text = lines.join('\n');
  check('the remedy names the MSB8040 error, so the log can be matched to it', /MSB8040/.test(text));
  check('it names the exact Visual Studio component', /MSVC v142 - VS 2019 C\+\+ x64\/x86 Spectre-mitigated libs/.test(text));
  // ONE RUNNABLE COMMAND PER COMPONENT ID, not "at least one". A `some()` here let a mutation that
  // broke the first of the two commands pass, because the second still matched — and a reader given
  // one good command and one mangled one is worse off than one given a single command.
  const runnable = lines.filter((l) => /vs_installer\.exe" modify --installPath "[^"]+" --add Microsoft\.VisualStudio\.Component\.VC\.[\w.]+ --passive --norestart$/.test(l));
  check('every component id comes as a complete, runnable command',
    runnable.length === facts.SPECTRE.componentIds.length,
    `${runnable.length} runnable of ${facts.SPECTRE.componentIds.length} ids`);
  check('and each id appears in exactly one of them',
    facts.SPECTRE.componentIds.every((id) => runnable.filter((l) => l.includes(`--add ${id} `)).length === 1));
  check('BOTH catalogue component ids are offered', facts.SPECTRE.componentIds.length === 2
    && /VC\.v142\.x86\.x64\.Spectre/.test(text) && /VC\.14\.29\.16\.11\.x86\.x64\.Spectre/.test(text));
  // THE TRAP THIS AVOIDS: `vs_installer --add` with an id the catalogue does not know installs
  // nothing and still reports success, so a single guessed id would be worse than no command.
  check('it warns that an unknown id installs nothing without failing',
    /installs nothing without failing/i.test(text));
  check('and names the GUI as the authority when the commands do nothing',
    /Visual Studio Installer/.test(text) && /Individual components/.test(text));
  check('the install path is a parameter, since the component must go to the install node-gyp used',
    facts.spectreCommands('D:\\VS\\BT').some((l) => l.includes('D:\\VS\\BT')));
  check('the Microsoft documentation is cited rather than paraphrased from memory',
    /learn\.microsoft\.com.*msb8040/i.test(facts.SPECTRE.docs));
  check('nothing in the remedy tells master to npm install a native module',
    !/npm install/i.test(text), text);
}

// ─── Said once ───────────────────────────────────────────────────────────────────────────────────
section('said once, so one copy cannot go false while the others look right');
{
  check('the facts module requires nothing, so beforeBuild still runs without node_modules',
    !/^\s*(const|let|var).*=\s*require\(/m.test(read(FACTS_FILE)),
    (read(FACTS_FILE).match(/require\([^)]*\)/g) || []).join(','));
  check('it ships, because the installed app must state the same limits the build recorded', (() => {
    const files = require('../package.json').build.files;
    return files.some((f) => /^shared\//.test(String(f)));
  })());

  for (const file of CONSUMERS) {
    const src = read(file);
    check(`${file} reads the shared facts`, /nativeModuleFacts\.cjs/.test(src));
    // In CODE, not in comments: the comments deliberately name the false claim as history.
    check(`${file} carries no copy of the false claim`, !/piped shell/i.test(codeOnly(src)),
      (codeOnly(src).match(/.*piped shell.*/i) || []).join(' | '));
  }
  check('buildInstaller declares the consequences in ONE function that delegates',
    /function nativeDegradations\(\)\s*\{[^}]*nativeFacts\.consequences\(\)/.test(read('scripts/buildInstaller.cjs')));
  check('and the build prints the remedy it can act on, not a sentence about the installer',
    /function nativeRemedy\(\)/.test(read('scripts/buildInstaller.cjs'))
    && /for \(const r of nativeRemedy\(\)\)/.test(read('scripts/buildInstaller.cjs')));
  check('the degraded block no longer claims the package merely ships weaker',
    /BROKEN or degraded native modules/.test(read('scripts/buildInstaller.cjs')));
}

// ─── A native module is probed by LOADING, not resolving ─────────────────────────────────────────
section('the probe asks the question that can actually fail');
{
  const src = read('electron/lib/startupDoctor.cjs');
  check('argon2 and node-pty are no longer in the resolve-only optional list',
    !doctor.RUNTIME_OPTIONAL.some((d) => d.name === 'argon2' || d.name === 'node-pty'),
    doctor.RUNTIME_OPTIONAL.map((d) => d.name).join(','));
  check('they are declared as native instead',
    doctor.NATIVE.includes('argon2') && doctor.NATIVE.includes('node-pty'));
  check('the resolve-only check is still used for the pure-JS optionals, unchanged',
    doctor.RUNTIME_OPTIONAL.length > 0 && /const present = resolves\(dep\.name\)/.test(src));

  // THE THREE STATES, DRIVEN. On this machine both modules load, so the interesting two cases can
  // only be reached by injection — and they are the two whose message was wrong.
  const loaded = doctor.loads('whatever', { req: () => 1, res: () => true });
  check('a module that loads is reported ok', loaded.ok === true && loaded.kind === 'loaded');
  check('and carries no error', loaded.error === null);

  const notBuilt = doctor.loads('node-pty', {
    req: () => { throw new Error('The specified module could not be found.\\\\?\\C:\\app\\pty.node'); },
    res: () => true,
  });
  check('INSTALLED BUT NOT BUILT is its own state, not "missing"',
    notBuilt.ok === false && notBuilt.kind === 'not-built', JSON.stringify(notBuilt));
  check('and the underlying loader error is kept, not swallowed',
    /could not be found/.test(notBuilt.error || ''));

  const absent = doctor.loads('node-pty', {
    req: () => { const e = new Error("Cannot find module 'node-pty'"); e.code = 'MODULE_NOT_FOUND'; throw e; },
    res: () => false,
  });
  check('genuinely absent is distinguished from unbuilt',
    absent.ok === false && absent.kind === 'not-installed', JSON.stringify(absent));
  check('the two states are not the same value, which is the whole point',
    notBuilt.kind !== absent.kind);

  // The live machine, whatever it happens to be: the probe must produce a finding or a pass, never
  // a throw, for both declared modules.
  for (const name of doctor.NATIVE) {
    let threw = null;
    try { doctor.loads(name); } catch (err) { threw = err.message; }
    check(`probing ${name} for real does not throw`, threw === null, threw);
  }
}

// ─── What the diagnosis says about it ────────────────────────────────────────────────────────────
section('the diagnosis reports it, and the build manifest changes how it reads');
{
  const base = { safeRequireFailures: [], crashReports: [] };
  const live = doctor.diagnose(base);
  check('both native modules appear in the report', (() => {
    const labels = live.report.map((r) => r.label);
    return doctor.NATIVE.every((n) => labels.includes(n));
  })(), live.report.map((r) => r.label).join(','));
  check('the diagnosis still returns the documented shape',
    Array.isArray(live.fatal) && Array.isArray(live.degraded) && Array.isArray(live.report));

  // ── A FAILED LOAD BECOMES A NAMED DEGRADATION, driven rather than pattern-matched ──
  //
  // The first draft of this section asserted only the SHAPE of the code, and a mutation that
  // reverted the probe to `resolves()` survived it: the regexes still matched, because the lines
  // they matched were still there. `ctx.probeNative` exists so the failure can be handed to
  // `diagnose` and its output read.
  const unbuilt = doctor.diagnose({
    ...base,
    probeNative: (name) => (name === 'node-pty'
      ? { ok: false, kind: 'not-built', error: 'pty.node could not be found' }
      : { ok: true, kind: 'loaded', error: null }),
  });
  const nrow = unbuilt.degraded.find((d) => d.id === 'native-node-pty');
  check('an unbuilt native module becomes a degradation the diagnosis reports',
    !!nrow, JSON.stringify(unbuilt.degraded.map((d) => d.id)));
  check('and it is a DEGRADATION, never fatal — the app still starts and everything else works',
    !unbuilt.fatal.some((f) => /node-pty/.test(f.id || '')));
  check('its detail is the true sentence from the shared facts',
    !!nrow && /terminal is DISABLED/i.test(nrow.detail) && /did not compile/.test(nrow.detail),
    nrow && nrow.detail);
  check('its remedy is the Spectre command, not an npm instruction',
    !!nrow && /vs_installer\.exe" modify/.test(nrow.remedy) && !/npm install node-pty/.test(nrow.remedy),
    nrow && String(nrow.remedy).slice(0, 120));
  check('the report line says installed-but-unbuilt rather than absent', (() => {
    const row = unbuilt.report.find((r) => r.label === 'node-pty');
    return row && row.pass === false && /never built/.test(row.note);
  })(), JSON.stringify(unbuilt.report.find((r) => r.label === 'node-pty')));
  check('a module that loaded is not reported as degraded alongside it',
    !unbuilt.degraded.some((d) => d.id === 'native-argon2'));

  // And genuinely absent gets the npm instruction, because there it is the right answer.
  const gone = doctor.diagnose({
    ...base,
    probeNative: () => ({ ok: false, kind: 'not-installed', error: 'Cannot find module' }),
  });
  const grow = gone.degraded.find((d) => d.id === 'native-argon2');
  check('a genuinely absent native module is told to npm install',
    !!grow && /npm install argon2/.test(grow.remedy), grow && grow.remedy);
  check('and says "is not installed", not "did not compile"',
    !!grow && /is not installed/.test(grow.detail) && !/did not compile/.test(grow.detail));

  const dsrc = read('electron/lib/startupDoctor.cjs');
  check('a native failure is pushed as a degradation with a module name', /id: `native-\$\{name\}`/.test(dsrc));
  check('its detail comes from the shared facts, not from a sentence written here',
    /fact \? fact\.whenMissing/.test(dsrc));
  check('a not-built failure is given the command, not "npm install"',
    /nativeFacts\.remedyLines\(\)/.test(dsrc));
  check('the note distinguishes unbuilt from absent in the report line too',
    /installed but its native binding was never built/.test(dsrc));

  // ── THE FACT THAT WAS RECORDED AND READ BY NOTHING (Section 178 -> 183) ──
  const withManifest = doctor.diagnose({
    ...base,
    buildManifest: {
      version: '1.0.0', builtAt: '2026-11-05T00:00:00.000Z',
      readiness: { verdict: 'ready-with-limits', degraded: [] },
      nativeModules: { rebuilt: false, error: 'MSB8040', degraded: ['argon2', 'node-pty'],
        consequences: facts.consequences() },
    },
    safeRequireFailures: [{ name: 'node-pty', reason: 'binding not built' }],
  });
  const row = withManifest.degraded.find((d) => d.id === 'load-node-pty');
  check('a degradation the BUILD already knew about is marked expected', !!row && row.expected === true,
    JSON.stringify(withManifest.degraded.map((d) => [d.id, !!d.expected])));
  check('and says so in words, so it does not read as damage to this installation',
    !!row && /known at build time, not a fault in this installation/.test(row.detail));

  // Without the manifest entry the SAME failure must read as a fault — otherwise the check above
  // would pass for a reason that has nothing to do with the manifest.
  const noManifest = doctor.diagnose({
    ...base,
    buildManifest: { version: '1.0.0', readiness: { degraded: [] } },
    safeRequireFailures: [{ name: 'node-pty', reason: 'binding not built' }],
  });
  const bare = noManifest.degraded.find((d) => d.id === 'load-node-pty');
  check('while the same failure with NOTHING recorded is not excused',
    !!bare && bare.expected !== true && !/known at build time/.test(bare.detail));
  check('the known-set reads BOTH manifest sources, not just readiness.degraded',
    /nativeModules\?\.degraded/.test(dsrc));
}

// ─── A fetch cannot supply a compiler (Section 183.6) ───────────────────────────────────────────
//
// In a function because `repair()` is async and this is a .cjs file, so there is no top-level
// await. Called at the bottom, before the summary.
async function repairSection() {
  section('repair does not try to download its way out of a missing compiler');
  // THE REGRESSION THIS GUARDS, and it was mine. Before 183.2 a present-but-unbuilt native module
  // produced no degradation at all, because `require.resolve` succeeded — so `repair()` never saw
  // it. Reporting it honestly put it in front of a repair pass that fetches the lockfile tarball,
  // and that tarball carries no binding for Electron's ABI. On a build with no manifest to mark it
  // expected, every launch would have spent a network round trip failing to fix it, and a
  // "successful" extraction would leave resolve passing while require still threw.
  const unbuilt = doctor.diagnose({
    safeRequireFailures: [], crashReports: [],
    probeNative: () => ({ ok: false, kind: 'not-built', error: 'pty.node could not be found' }),
  });
  check('a native degradation is marked as not fetchable',
    unbuilt.degraded.filter((d) => /^native-/.test(d.id)).every((d) => d.fetchable === false),
    JSON.stringify(unbuilt.degraded.map((d) => [d.id, d.fetchable])));

  const r = await doctor.repair(unbuilt, { safeRequireFailures: [], crashReports: [] });
  check('so repair attempts NOTHING for it', r.attempted.length === 0, JSON.stringify(r.attempted));
  check('and says why, rather than silently skipping it',
    r.notes.some((n) => /needs a compiler, not a download|needs a C\+\+ toolchain/.test(n)),
    JSON.stringify(r.notes));
  check('it does not claim to have repaired anything', r.repaired.length === 0);

  // THE FLAG ON ITS OWN, tested with a module that is NOT in `NATIVE`. Two guards cover these two
  // packages — the row's flag and the sweep over `NATIVE` — so a mutation to either one survives
  // while the other still holds. That is fine as defence, useless as evidence: without this case
  // the suite could not say whether `fetchable: false` is honoured at all, which is what any
  // FUTURE unfixable-by-download entry will depend on.
  const flagged = await doctor.repair(
    { fatal: [], degraded: [{ id: 'dep-sharp', module: 'sharp', detail: 'sharp did not load', fetchable: false }] },
    { safeRequireFailures: [], crashReports: [] },
  );
  check('`fetchable: false` alone is enough to skip a module outside the NATIVE list',
    !flagged.attempted.includes('sharp'), JSON.stringify(flagged.attempted));
  check('and it is explained rather than dropped',
    flagged.notes.some((n) => /sharp/.test(n) && /not a download/.test(n)), JSON.stringify(flagged.notes));
  // Mirror: the SAME entry without the flag is attempted, so the check above is about the flag.
  const unflagged = await doctor.repair(
    { fatal: [], degraded: [{ id: 'dep-sharp', module: 'sharp', detail: 'sharp did not load' }] },
    { safeRequireFailures: [], crashReports: [] },
  );
  check('while the same entry WITHOUT the flag is attempted',
    unflagged.attempted.includes('sharp'), JSON.stringify(unflagged.attempted));

  // The OTHER route in: a safeRequire failure naming the same module by its error text.
  const viaReason = await doctor.repair(
    { fatal: [], degraded: [] },
    { safeRequireFailures: [{ name: 'terminal', reason: "Cannot find module 'node-pty'" }], crashReports: [] },
  );
  check('a native named through a "Cannot find module" reason is dropped too',
    !viaReason.attempted.includes('node-pty'), JSON.stringify(viaReason.attempted));
  check('and that path explains itself as well',
    viaReason.notes.some((n) => /node-pty/.test(n) && /toolchain|compiler/.test(n)),
    JSON.stringify(viaReason.notes));

  // NON-VACUOUS: a pure-JS module must still be attempted, or the guard above would be proving
  // nothing more than "repair does nothing".
  const js = await doctor.repair(
    { fatal: [], degraded: [] },
    { safeRequireFailures: [{ name: 'sysinfo', reason: "Cannot find module 'debug'" }], crashReports: [] },
  );
  check('a pure-JS module IS still attempted — the exclusion is narrow',
    js.attempted.includes('debug'), JSON.stringify(js.attempted));
  check('the banner\u2019s claim that a native module is out of reach is now enforced in code',
    /for \(const name of NATIVE\) \{\s*\n\s*if \(wanted\.delete\(name\)\)/.test(read('electron/lib/startupDoctor.cjs')));
}

// ─── The message master actually meets ──────────────────────────────────────────────────────────
section('the terminal says which fault it is');
{
  const t = read('electron/ipc/terminal.cjs');
  check('the old advice is gone', !/error: 'node-pty not installed\. Run: npm install node-pty'/.test(t));
  check('the two cases are distinguished at load time', /kind: resolvable \? 'not-built' : 'not-installed'/.test(t));
  check('the unbuilt case says npm will NOT fix it, which is the part that wasted the time',
    /will not fix it/.test(t));
  check('the unbuilt case says no command can run', /no command can run/.test(t));
  check('the unbuilt case carries the Spectre remedy', /facts\.remedyLines\(\)/.test(t));
  check('the genuinely-absent case still gets the npm instruction it deserves',
    /npm install node-pty/.test(t) && /not installed, so no command can run/.test(t));
  check('the console warning says DISABLED rather than implying a fallback',
    /the terminal is `\s*\n?\s*\+ 'DISABLED|DISABLED: no command will run/.test(t), 'console.warn wording');
  check('one helper, called from the handler, rather than a copy per handler',
    /function ptyUnavailable\(\)/.test(t) && /if \(!pty\) return ptyUnavailable\(\);/.test(t));

  // ── AND THE SCREEN SHOWS IT, which it never did (Section 183.6) ──
  //
  // `Terminal.jsx` tested `res.error.includes('may not')` and otherwise printed a sentence written
  // in the component. No handler has ever produced a message containing "may not", so the
  // component's own fallback is what master always saw — the handler's diagnosis, old or new,
  // reached the screen exactly never.
  const ui = read('src/pages/Terminal/Terminal.jsx');
  // Comment-stripped, for the same reason as the "piped shell" ban: the comment above the fix
  // quotes the sniff it replaced, and a check that cannot tell code from its own history would
  // force the history to be deleted.
  check('the page no longer sniffs the error text for a string nothing produces',
    !/includes\('may not'\)/.test(codeOnly(ui)),
    (codeOnly(ui).match(/.*may not.*/) || []).join(' | '));
  check('it renders the handler\u2019s own error', /text: `⚠ \$\{res\.error/.test(codeOnly(ui)),
    'res.error not rendered');
  check('it renders the remedy that travels with it', /res\.remedy/.test(ui));
  check('an error with no text still produces a sentence rather than a bare warning sign',
    /no reason was reported/i.test(ui));
  check('and the simulated session no longer implies commands run',
    /commands are echoed, not executed/i.test(ui));
}

repairSection()
  .catch((err) => { check('the repair section ran without throwing', false, err.message); })
  .then(() => {
    console.log(`\n${'='.repeat(62)}`);
    console.log(`  ${pass} passed, ${fail} failed`);
    console.log('='.repeat(62));
    process.exit(fail === 0 ? 0 : 1);
  });
