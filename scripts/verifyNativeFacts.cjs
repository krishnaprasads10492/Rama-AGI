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
const os = require('os');
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
  // The tail is `--passive --norestart --wait` since Section 189. Asserted as a whole rather than
  // loosely, because this regex is what proves no malformed line slipped in beside the good one.
  const runnable = lines.filter((l) => /vs_installer\.exe" modify --installPath "[^"]+" --add Microsoft\.VisualStudio\.Component\.VC\.[\w.]+ --passive --norestart --wait$/.test(l));
  check('every component id comes as a complete, runnable command',
    runnable.length === facts.SPECTRE.componentIds.length,
    `${runnable.length} runnable of ${facts.SPECTRE.componentIds.length} ids`);

  // ── AND NO OTHERS. THE DEFECT THIS CATCHES SHIPPED (Section 188) ──
  //
  // `spectreCommands()` built its two lines from `componentIds[0]` and `componentIds[1]`. Section
  // 186.6 cut the list to the one published id, the second line kept rendering, and the remedy
  // printed `--add undefined` into master's build log. The check above counted the WELL-FORMED
  // lines and found 1 of 1 — it never counted the total, so a malformed extra line was invisible.
  // Counting the good ones is not the same as asserting there are no bad ones.
  const allCommands = lines.filter((l) => /vs_installer\.exe" modify/.test(l));
  check('and there are NO command lines beyond those, malformed or otherwise',
    allCommands.length === runnable.length,
    allCommands.filter((l) => !runnable.includes(l)).join(' | '));
  check('the trailing prose agrees with how many commands there actually are', (() => {
    const tail = lines[lines.length - 1];
    return allCommands.length === 1 ? /that command does not/.test(tail) : /none of those commands/.test(tail);
  })(), lines[lines.length - 1]);
  check('and each id appears in exactly one of them',
    facts.SPECTRE.componentIds.every((id) => runnable.filter((l) => l.includes(`--add ${id} `)).length === 1));
  // ONLY PUBLISHED IDS (Section 186.6). `…VC.v142.x86.x64.Spectre` led this list and is in
  // Microsoft's component list for NEITHER catalogue — I constructed it. Master ran it against a
  // machine whose toolset is 14.29.30133, nothing installed, and `vs_installer` exited 0, so the
  // failure was silent and cost a round trip. An id that cannot be cited is not offered.
  check('every offered component id is version-pinned, which is the published form',
    facts.SPECTRE.componentIds.every((id) => /^Microsoft\.VisualStudio\.Component\.VC\.\d+\.\d+\.\d+\.\d+\.x86\.x64\.Spectre$/.test(id)),
    facts.SPECTRE.componentIds.join(', '));
  check('the constructed v142 alias is gone', !/VC\.v142\.x86\.x64\.Spectre/.test(text));
  check('the published 14.29 id is present, since that is the toolset on the build machine',
    /VC\.14\.29\.16\.11\.x86\.x64\.Spectre/.test(text));
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

  // ── A LAUNCHER'S EXIT CODE IS NOT EVIDENCE (Section 189) ──
  //
  // `vs_installer.exe` hands the request to the setup engine and exits, so the shell reports
  // success before anything is installed. Master ran the command, saw PowerShell exit cleanly, and
  // the libraries were still absent — twice. `--wait` makes the exit code belong to the operation.
  check('every install command waits for the operation it started',
    facts.spectreCommands().every((l) => !/vs_installer/.test(l) || /--wait\b/.test(l)),
    facts.spectreCommands().filter((l) => /vs_installer/.test(l) && !/--wait/.test(l)).join(' | '));
  check('and the remedy says it needs elevation', /ELEVATED prompt/.test(text));
  check('it names where the installer records what it actually did',
    /%TEMP%\\dd_installer_\*\.log/.test(text) && /search for "error"/.test(text));
  check('and points at the on-disk check rather than the exit code',
    /doctor:toolchain/.test(text) && /rather than trusting the exit code/.test(text));
  check('the log location is declared once, beside the installer path',
    typeof facts.SPECTRE.logs === 'string' && /dd_installer/.test(facts.SPECTRE.logs));

  // ── The id is LOOKED UP per toolset, never constructed (Section 186.6) ──
  const got = facts.spectreComponentFor('14.29.30133');
  check('the toolset actually on the build machine maps to a confirmed id',
    !!got && got.id === 'Microsoft.VisualStudio.Component.VC.14.29.16.11.x86.x64.Spectre',
    JSON.stringify(got));
  check('and it carries the human name the GUI shows, so the checkbox can be found',
    !!got && /Spectre-mitigated libs \(v14\.29-16\.11\)/.test(got.name));
  check('an UNKNOWN toolset returns null rather than a constructed id',
    facts.spectreComponentFor('14.44.99') === null
    && facts.spectreComponentFor('') === null
    && facts.spectreComponentFor(undefined) === null);
  check('every entry in the table is version-pinned and x64/x86',
    Object.values(facts.SPECTRE_BY_TOOLSET).every((e) => /\.\d+\.\d+\.\d+\.\d+\.x86\.x64\.Spectre$/.test(e.id)),
    JSON.stringify(facts.SPECTRE_BY_TOOLSET));
  check('the table cites where the ids came from, so the next reader can check them',
    /workload-component-id-vs-build-tools/.test(read(FACTS_FILE)));
}

// ─── Nothing printed to master contains a failed interpolation (Section 188) ────────────────────
section('no "undefined" reaches a sentence master reads');
{
  // THE GENERAL FORM OF THE DEFECT, which is what makes this worth a section of its own. An index
  // outliving its array printed `--add undefined` as a COMMAND master was told to run. Every
  // string this module and the probe can emit is swept, because the next one will come from a
  // different interpolation and a check aimed only at `--add` would miss it.
  const everything = [
    ...facts.consequences(),
    ...facts.remedyLines(),
    ...facts.spectreCommands(),
    ...facts.spectreCommands('D:\\Custom\\Path'),
    facts.summaryLine(),
    ...Object.values(facts.SPECTRE_BY_TOOLSET).flatMap((e) => [e.id, e.name]),
    ...Object.values(facts.SPECTRE).flatMap((v) => (Array.isArray(v) ? v : [String(v)])),
  ].map(String);

  for (const bad of ['undefined', 'null', 'NaN', '\\[object Object\\]']) {
    const hits = everything.filter((s) => new RegExp(bad).test(s));
    check(`nothing emitted contains "${bad.replace(/\\/g, '')}"`, hits.length === 0, hits.join(' | '));
  }
  check('every emitted line is a non-empty string',
    everything.every((s) => typeof s === 'string' && s.trim().length > 0));

  // The probe's output, across every verdict, swept the same way.
  const tp2 = require('../scripts/toolchainProbe.cjs');
  const verdicts = [
    { verdict: 'not-windows', instances: [], spectreFound: [], reason: 'x' },
    { verdict: 'unknown', instances: [], spectreFound: [], reason: 'x' },
    { verdict: 'no-visual-studio', instances: [], spectreFound: [], reason: null },
    { verdict: 'no-cpp-toolset', instances: [{ path: 'C:\\A', name: 'BT', version: '1', toolsets: [] }], spectreFound: [], reason: null },
    { verdict: 'spectre-missing', instances: [{ path: 'C:\\A', name: 'BT', version: '1', toolsets: [{ version: '14.29.1', spectre: false }] }], spectreFound: [], reason: null },
    { verdict: 'spectre-present', instances: [{ path: 'C:\\A', name: 'BT', version: '1', toolsets: [{ version: '14.29.1', spectre: true }] }], spectreFound: [{ path: 'C:\\A', toolset: '14.29.1' }], reason: null },
  ];
  for (const v of verdicts) {
    const text = tp2.lines(v).join('\n');
    check(`the ${v.verdict} report contains no failed interpolation`,
      !/undefined|\[object Object\]|NaN/.test(text),
      (text.match(/.*(undefined|\[object Object\]|NaN).*/g) || []).join(' | '));
  }
}

// ─── One failure report, shared by both paths (Section 188) ─────────────────────────────────────
section('a real build and a hand-run say the same thing');
{
  const rn = require('../scripts/rebuildNatives.cjs');
  check('the failure report is a shared export, not a copy per caller',
    typeof rn.reportFailure === 'function');

  const out = [];
  rn.reportFailure('simulated', (l) => out.push(l));
  check('it names the failure', out.some((l) => /failed: simulated/.test(l)));
  check('it carries the consequences', out.some((l) => /terminal is DISABLED/.test(l)));
  check('it carries the remedy command', out.some((l) => /vs_installer\.exe" modify/.test(l)));
  // THE GAP MASTER'S BUILD LOG SHOWED: the probe reached the hand-run path only.
  check('and it carries the machine-specific probe, which the build path lacked',
    out.some((l) => /TOOLCHAIN PROBE/.test(l)) && out.some((l) => /VERDICT/.test(l)));
  check('nothing in the report contains a failed interpolation',
    !out.some((l) => /undefined|\[object Object\]/.test(l)), out.filter((l) => /undefined/.test(l)).join(' | '));

  const bb2 = codeOnly(read('scripts/beforeBuild.cjs'));
  check('the build hook calls the shared report rather than printing its own lines',
    /reportFailure\(outcome\.error\)/.test(bb2));
  check('and no longer loops over the facts itself',
    !/for \(const line of facts\.(consequences|remedyLines)\(\)\)/.test(bb2));
  check('the CLI calls it too, so there is exactly one reporting path',
    /reportFailure\(res\.error\)/.test(codeOnly(read('scripts/rebuildNatives.cjs'))));
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

// ─── Which of the four reasons the rebuild failed (Section 186) ──────────────────────────────────
section('the failure diagnoses itself instead of repeating generic advice');
{
  const tp = require('../scripts/toolchainProbe.cjs');

  // EVERY VERDICT IS DRIVEN, because this machine can only produce one of them and the other four
  // are the ones that matter on master's. `exec`, `exists` and `readdir` are parameters for exactly
  // this reason; mocking the module system to reach them would prove less and break more.
  const io = ({ files = [], dirs = {}, out = '[]', throws = null, platform = 'win32' }) => ({
    platform,
    exec: () => { if (throws) throw new Error(throws); return out; },
    exists: (p) => files.includes(p),
    readdir: (p) => dirs[p] || [],
  });
  const VSW = tp.VSWHERE;
  const VS = 'C:\\VS\\BuildTools';
  const MSVC = `${VS}\\VC\\Tools\\MSVC`;

  check('not Windows is answered as inapplicable, not as a fault',
    tp.probe(io({ platform: 'linux' })).verdict === 'not-windows');

  const noVswhere = tp.probe(io({ files: [] }));
  check('a missing vswhere is UNKNOWN, never "no Visual Studio"',
    noVswhere.verdict === 'unknown' && /vswhere\.exe was not found/.test(noVswhere.reason));
  check('and the unknown case admits the Spectre advice is then a guess',
    /a guess rather than a diagnosis/.test(tp.lines(noVswhere).join(' ')));

  check('a vswhere that throws is UNKNOWN with the reason carried',
    (() => { const f = tp.probe(io({ files: [VSW], throws: 'access denied' }));
      return f.verdict === 'unknown' && /access denied/.test(f.reason); })());
  check('output that is not JSON is UNKNOWN rather than parsed hopefully',
    tp.probe(io({ files: [VSW], out: 'not json' })).verdict === 'unknown');
  check('a JSON shape that is not an array is UNKNOWN',
    tp.probe(io({ files: [VSW], out: '{"installationPath":"x"}' })).verdict === 'unknown');

  const none = tp.probe(io({ files: [VSW], out: '[]' }));
  check('zero instances is reported as no Visual Studio at all', none.verdict === 'no-visual-studio');
  check('and that advice says install the C++ workload FIRST, not the Spectre component',
    /Spectre\n?\s*component is an addition/.test(tp.lines(none).join('\n'))
    || /must already exist/.test(tp.lines(none).join('\n')));

  // THE CASE THE FIRST REAL RUN OF THIS PROBE EXPOSED: an instance with no MSVC toolset at all.
  // The verdict used to be `spectre-missing`, and the advice told the reader to tick the entry
  // matching "one listed above" when nothing was listed.
  const bare = tp.probe(io({ files: [VSW], out: JSON.stringify([{ installationPath: VS, displayName: 'BT', installationVersion: '17.0' }]) }));
  check('an instance with NO MSVC toolset is its own verdict', bare.verdict === 'no-cpp-toolset',
    bare.verdict);
  check('and its advice does not tell the reader to match an empty list',
    !/matches\s+one listed above/.test(tp.lines(bare).join(' ')));
  check('it says the Spectre component alone will not help',
    /Spectre component alone will not help/.test(tp.lines(bare).join(' ')));

  // Toolsets present, no Spectre libs — the case master is probably in.
  const missing = tp.probe(io({
    files: [VSW, MSVC],
    dirs: { [MSVC]: ['14.29.30133'] },
    out: JSON.stringify([{ installationPath: VS, displayName: 'BT 2019', installationVersion: '16.11' }]),
  }));
  check('toolsets present but no spectre libs is spectre-missing', missing.verdict === 'spectre-missing');
  check('the toolset is listed with its lack stated', (() => {
    const t = tp.lines(missing).join('\n');
    return /14\.29\.30133 \(no spectre libs\)/.test(t);
  })(), tp.lines(missing).join(' | '));
  check('and the advice names the silent-no-op trap rather than repeating the command',
    /unknown id installs/.test(tp.lines(missing).join('\n')));
  // The same launcher lesson, in the probe's own advice.
  check('the probe says a clean exit code is not evidence', (() => {
    const t = tp.lines(missing).join('\n');
    return /ELEVATED prompt/.test(t) && /exits before the/.test(t) && /not evidence/.test(t);
  })(), tp.lines(missing).join(' | '));
  check('and names the installer log as where the reason is',
    /dd_installer/.test(tp.lines(missing).join('\n')));

  // THE EXACT COMMAND FOR THE TOOLSET FOUND — master's case, reproduced from the probe output he
  // sent: Build Tools 2019 with toolset 14.29.30133 and no spectre libs, beside an SSMS instance
  // that vswhere also reports and that must not affect the verdict.
  const real = tp.probe(io({
    files: [VSW, MSVC],
    dirs: { [MSVC]: ['14.29.30133'] },
    out: JSON.stringify([
      { installationPath: VS, displayName: 'Visual Studio Build Tools 2019', installationVersion: '16.11.36227.6' },
      { installationPath: 'C:\\SSMS\\Release', displayName: 'SQL Server Management Studio 21', installationVersion: '21.4' },
    ]),
  }));
  const rtext = tp.lines(real).join('\n');
  check('an unrelated VS-shell instance does not change the verdict',
    real.verdict === 'spectre-missing', real.verdict);
  check('the advice emits ONE ready-to-run command, not a choice of two',
    (rtext.match(/vs_installer\.exe" modify/g) || []).length === 1,
    (rtext.match(/vs_installer\.exe" modify/g) || []).length);
  check('and it carries the id matching the toolset that is actually installed',
    /--add Microsoft\.VisualStudio\.Component\.VC\.14\.29\.16\.11\.x86\.x64\.Spectre/.test(rtext));
  check('aimed at the instance that has the toolset, not the other one',
    /--installPath "C:\\VS\\BuildTools"/.test(rtext) && !/SSMS/.test(rtext.split('RUN THIS')[1] || ''));
  // COUNTED, not just "at least one". The command list must be exactly the (instance, toolset)
  // pairs with a confirmed id — a mutation that handed every instance a line survived a check that
  // only counted `=== 1`, because the lookup happened to reject the extra one. Counting the pairs
  // makes the assertion about the selection rather than about a coincidence.
  const pairs = real.instances.flatMap((i) => i.toolsets
    .filter((t) => facts.spectreComponentFor(t.version)).map((t) => `${i.path}|${t.version}`));
  check('one command per instance-and-toolset pair with a confirmed id, and no others',
    (rtext.match(/vs_installer\.exe" modify/g) || []).length === pairs.length && pairs.length === 1,
    `${pairs.length} pair(s): ${pairs.join(', ')}`);
  check('it names the toolset so the GUI checkbox can be matched', /14\.29\.30133 ->/.test(rtext));
  check('and the GUI is still named as the authority if the command changes nothing',
    /GUI is authoritative/.test(rtext));

  // An unknown toolset must NOT produce a constructed command.
  const odd = tp.probe(io({
    files: [VSW, MSVC],
    dirs: { [MSVC]: ['14.99.12345'] },
    out: JSON.stringify([{ installationPath: VS, displayName: 'BT', installationVersion: '99' }]),
  }));
  const otext = tp.lines(odd).join('\n');
  check('an unknown toolset yields NO command rather than an invented id',
    !/--add Microsoft/.test(otext), otext);
  check('and says why the id cannot be constructed', /cannot be/.test(otext) && /guessed id installs nothing/.test(otext));

  // Spectre libs PRESENT and the build still failed — the loop this module exists to break.
  const present = tp.probe(io({
    files: [VSW, MSVC, `${MSVC}\\14.29.30133\\lib\\spectre`],
    dirs: { [MSVC]: ['14.29.30133'] },
    out: JSON.stringify([{ installationPath: VS, displayName: 'BT 2019', installationVersion: '16.11' }]),
  }));
  check('spectre libs on disk are detected', present.verdict === 'spectre-present'
    && present.spectreFound.length === 1, JSON.stringify(present.spectreFound));
  const ptext = tp.lines(present).join('\n');
  check('and the advice STOPS saying install the component', !/Individual components/.test(ptext), ptext);
  check('it names the instance-selection cause and how to pin it', /GYP_MSVS_VERSION/.test(ptext));
  check('it names the architecture cause', /different ARCHITECTURE/.test(ptext));
  check('and it says the error may no longer be MSB8040 at all', /no longer MSB8040/.test(ptext));

  // The VS2015 layout, which produces the identical error from a different directory.
  const legacy = tp.probe(io({
    files: [VSW, `${VS}\\VC\\lib\\spectre`],
    out: JSON.stringify([{ installationPath: VS, displayName: 'VS2015', installationVersion: '14.0' }]),
  }));
  check('the VS2015 lib layout is recognised too', legacy.verdict === 'spectre-present');

  // IT MUST NOT ACT. A probe that installs something is no longer a probe.
  const src = read('scripts/toolchainProbe.cjs');
  const code = codeOnly(src);
  // BANNED IN WHAT IT RUNS, NOT IN WHAT IT SAYS. The first draft banned the strings `vs_installer`
  // and `npm install` outright and failed on the probe's own ADVICE, which has to name them — the
  // same mistake as the "piped shell" ban firing on the comment that records it. What must be true
  // is that the probe never executes them.
  check('the probe writes nothing to disk',
    !/writeFileSync|mkdirSync|rmSync|unlinkSync|appendFileSync|copyFileSync/.test(code),
    (code.match(/\w+Sync\(/g) || []).join(','));
  check('and the ONLY thing it executes is vswhere', (() => {
    const calls = code.match(/exec(?:Sync)?\(\s*[^)]*/g) || [];
    // Two sites: the injected `exec(...)` in `probe`, and `execSync` inside `probeNow`'s adapter.
    return calls.length > 0 && calls.every((c) => /vswhere|cmd,/.test(c));
  })(), (code.match(/exec(?:Sync)?\(\s*[^)]*/g) || []).join(' | '));
  check('it never shells out to the installer it recommends',
    !/exec\w*\([^)]*vs_installer/.test(code));
  check('and reaches no network', !/https?:\/\/|http\.cjs|fetch\(/.test(code),
    (code.match(/https?:\/\/[^\s'"]*/g) || []).join(','));
  check('the real I/O is a separate function from the judgement, so the judgement is testable',
    /function probe\(/.test(code) && /function probeNow\(/.test(code));
  check('it is wired into the rebuild failure path', (() => {
    const r = read('scripts/rebuildNatives.cjs');
    return /toolchainProbe\.cjs/.test(r) && /probe\.lines\(probe\.probeNow\(\)\)/.test(r);
  })());

  // ── RUNNABLE ON ITS OWN, because checking cost a failed compile (Section 186.7) ──
  const pkgScripts = require(path.join(ROOT, 'package.json')).scripts;
  check('there is a standalone command to ask the question',
    pkgScripts['doctor:toolchain'] === 'node scripts/toolchainProbe.cjs', pkgScripts['doctor:toolchain']);
  check('the probe has its own CLI behind a require.main guard',
    /if \(require\.main === module\)/.test(src));
  check('and its exit code answers exactly one question — are the libraries there',
    /findings\.verdict === 'spectre-present' \? 0 : 1/.test(src));
  check('so UNKNOWN is not reported as success', (() => {
    // A check that cannot tell must not exit 0, or a script could read "fine" from "I don't know".
    const m = /process\.exit\(([^)]+)\)/.exec(src.split('require.main === module')[1] || '');
    return !!m && !/unknown/.test(m[1]);
  })());
  // THE HEADING MUST BE TRUE IN BOTH CONTEXTS. It said "why the native rebuild failed", which is
  // false when the standalone check runs and nothing has failed.
  check('the probe heading does not claim a failure that may not have happened',
    !/why the native rebuild failed/.test(tp.lines({ verdict: 'not-windows' }).join(' ')));
  check('and the rebuild path supplies that framing itself',
    /WHY IT FAILED/.test(read('scripts/rebuildNatives.cjs')));
  check('and a probe that throws does not take the rebuild report down with it',
    /the toolchain probe could not run/.test(read('scripts/rebuildNatives.cjs')));
}

// ─── An npm script that cannot run (Section 185) ─────────────────────────────────────────────────
section('every npm script names something that exists');
{
  // THE DEFECT: `"rebuild": "electron-rebuild"` — a bare binary name, which failed on master's
  // machine with "electron-rebuild is not recognized as an internal or external command". Section
  // 173 replaced the deprecated `electron-rebuild` package with `@electron/rebuild` in a
  // lockfile-only change, so no `node_modules/.bin/electron-rebuild` shim was ever linked. 45 other
  // shims exist; this was the only script naming one that does not. `beforeBuild.cjs` had already
  // solved it privately by reading the installed package's manifest, so the project held a correct
  // copy and a broken one — which is the whole argument for one implementation.
  const pkg = require(path.join(ROOT, 'package.json'));
  const rebuild = require('../scripts/rebuildNatives.cjs');

  check('the rebuild script invokes a file, not a bare binary name',
    /^node scripts\/rebuildNatives\.cjs$/.test(pkg.scripts.rebuild || ''), pkg.scripts.rebuild);
  check('and nothing anywhere still invokes a bare electron-rebuild',
    !Object.values(pkg.scripts).some((c) => /(^|[&|;]\s*)electron-rebuild\b/.test(String(c))),
    Object.entries(pkg.scripts).filter(([, c]) => /electron-rebuild/.test(String(c))).join(' | '));

  // THE GENERALISATION, which is the part worth keeping: ANY script naming a binary with no shim.
  // Scoped to what can be checked — if `.bin` is absent or nearly empty this is a fresh checkout
  // rather than a broken script, and the check says so instead of failing everything.
  const binDir = path.join(ROOT, 'node_modules', '.bin');
  const have = fs.existsSync(binDir)
    ? new Set(fs.readdirSync(binDir).map((f) => f.replace(/\.(cmd|ps1)$/, '')))
    : new Set();
  const KNOWN_ON_PATH = new Set(['node', 'npm', 'npx', 'cd', 'echo', 'set', 'python', 'electron']);
  if (have.size < 10) {
    check('node_modules/.bin was populated enough to check script binaries', false,
      `${have.size} shims — run npm install; this check cannot tell a broken script from a fresh checkout`);
  } else {
    const missing = new Set();
    for (const [name, cmd] of Object.entries(pkg.scripts || {})) {
      for (const seg of String(cmd).split(/&&|\|\||;/)) {
        const tok = seg.trim().split(/\s+/)[0];
        if (!tok || KNOWN_ON_PATH.has(tok)) continue;
        if (tok.startsWith('"') || tok.includes('/') || tok.includes('\\')) continue;
        if (!have.has(tok)) missing.add(`${name} -> ${tok}`);
      }
    }
    check(`no npm script names a binary with no shim (${have.size} shims checked)`,
      missing.size === 0, [...missing].join(', '));
  }

  // ONE IMPLEMENTATION, TWO CALLERS.
  check('the build hook delegates rather than carrying its own copy', (() => {
    const bb = read('scripts/beforeBuild.cjs');
    return /require\('\.\/rebuildNatives\.cjs'\)/.test(bb) && /rebuildNatives\(\{ root \}\)/.test(bb);
  })());
  check('and the hook no longer resolves the binary itself',
    !/node_modules', '@electron', 'rebuild'/.test(read('scripts/beforeBuild.cjs')));
  // TRANSITIVELY builtin-only. `beforeBuild.cjs` requires this chain and must still run on a
  // checkout with no `node_modules`, so every link in it is checked, not just the first.
  const builtinOnly = (rel) => (read(rel).match(/require\('([^']+)'\)/g) || [])
    .every((r) => /'(child_process|fs|os|path)'/.test(r)
      || /nativeModuleFacts\.cjs|toolchainProbe\.cjs|rebuildNatives\.cjs/.test(r));
  for (const rel of ['scripts/rebuildNatives.cjs', 'scripts/toolchainProbe.cjs',
    'shared/nativeModuleFacts.cjs']) {
    check(`${rel} requires only Node builtins and its siblings`, builtinOnly(rel),
      (read(rel).match(/require\('([^']+)'\)/g) || []).join(','));
  }

  // RESOLVED FROM THE PACKAGE, NOT FROM PATH — and reported, never fetched.
  const found = rebuild.resolveBin(ROOT);
  check('the binary resolves from the installed package manifest',
    found.ok === true && found.bin.includes(path.join('@electron', 'rebuild')),
    JSON.stringify(found));
  const absent = rebuild.rebuildNatives({ root: os.tmpdir(), stdio: 'pipe' });
  check('a missing package is REPORTED, not downloaded',
    absent.ok === false && /run npm install/.test(absent.error), JSON.stringify(absent));
  check('and nothing in the rebuild path reaches for npx',
    !/npx/.test(read('scripts/rebuildNatives.cjs').replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')));

  // The CLI must not compile on require, or importing it for a test would start a long build.
  check('the CLI is behind a require.main guard',
    /if \(require\.main === module\)/.test(read('scripts/rebuildNatives.cjs')));
  check('and when it fails by hand it prints the same consequences and remedy the build does',
    /facts\.consequences\(\)/.test(read('scripts/rebuildNatives.cjs'))
    && /facts\.remedyLines\(\)/.test(read('scripts/rebuildNatives.cjs')));
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
