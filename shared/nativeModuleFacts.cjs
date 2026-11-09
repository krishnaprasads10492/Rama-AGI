'use strict';

/**
 * nativeModuleFacts.cjs — what actually happens when a native module does not compile
 * (spec Section 183)
 *
 * WHY THIS FILE EXISTS, AND IT IS NOT TIDINESS. The same claim about node-pty was written three
 * times in three files, and it was WRONG in all three: `scripts/beforeBuild.cjs` printed "argon2
 * falls back to scrypt, node-pty to a piped shell — both work, both weaker",
 * `buildInstaller.cjs`'s `nativeDegradations()` said "the terminal is a piped shell rather than a
 * real pty", and `startupDoctor.cjs` listed node-pty as "a real terminal (falls back to a piped
 * shell)". There is no piped shell anywhere in this codebase. `electron/ipc/terminal.cjs` sets
 * `pty = null` and refuses every `terminal:create`; `src/pages/Terminal/Terminal.jsx` then renders
 * a session that answers every command with "Command not executed". The truth is that the terminal
 * is DISABLED, and master read "both work, both weaker" off his own build log on 2026-11-05.
 *
 * Three copies of a sentence is how one of them becomes false without the other two noticing. So
 * the consequence of each native module failing to build is declared ONCE, here, and the build
 * scripts, the startup diagnosis and the terminal's own error message all read it. It lives in
 * `shared/` because it is needed on both sides of packaging: the whole of `shared` is listed in
 * `build.files`, so the installed app states the same limits the build recorded.
 *
 * NO REQUIRES, NO SIDE EFFECTS. `beforeBuild.cjs` runs on a checkout that may have no
 * `node_modules` at all, so a dependency here would make the dependency installer need its own
 * dependencies first.
 *
 * A REMEDY IS A COMMAND WHERE ONE EXISTS. Section 176 established this: the Node-version advice was
 * prose until it was given the actual `nvm` commands. "Install the Visual Studio component" is
 * prose. What a reader can run is below, with the honest caveat about which catalogue holds which
 * component id.
 */

/**
 * THE WINDOWS CAUSE, which is the one seen in practice.
 *
 * node-gyp fails with `MSB8040: Spectre-mitigated libraries are required for this project`.
 * @electron/rebuild 4.x bundles a node-gyp that ENFORCES this where node-gyp 9.4.1 only warned, so
 * a machine that used to build these modules can start failing without changing (Section 177).
 *
 * Microsoft's own guidance for MSB8040 is to select the MSVC v142 Spectre-mitigated libs option for
 * every architecture the build targets, from the installer's Individual Components tab.
 * See https://learn.microsoft.com/en-us/visualstudio/msbuild/errors/msb8040
 *
 * TWO COMPONENT IDS, AND THE REASON BOTH ARE LISTED: the id depends on which installer catalogue
 * manages the install, not on which toolset is wanted. The VS 2019 Build Tools catalogue names the
 * then-current v142 libs `...VC.v142.x86.x64.Spectre`; the VS 2022 catalogue, which can also
 * install the v142 toolset, pins the version into the id as
 * `...VC.14.29.16.11.x86.x64.Spectre` ("MSVC v142 - VS 2019 C++ x64/x86 Spectre-mitigated libs
 * (v14.29-16.11)"). `vs_installer --add` with an id the catalogue does not know does NOT fail
 * loudly - it installs nothing and reports success - so a single guessed id would be worse than
 * useless. Both are offered, and the GUI is named as the authority.
 */
/**
 * Toolset directory prefix -> the EXACT component id for that toolset's x64/x86 Spectre libs.
 *
 * WHY A TABLE AND NOT A PATTERN (spec Section 186.6). The id is not derivable: it embeds both the
 * MSVC toolset version and the Visual Studio release that shipped it — `14.29` pairs with `16.11`,
 * `14.30` with `17.0` — so a constructed id would be a guess, and `vs_installer --add` with an id
 * the catalogue does not know installs nothing while exiting 0. Master lost a round trip to exactly
 * that. So this holds only entries confirmed against Microsoft's published component list, and
 * anything absent is answered with the GUI rather than an invented id.
 *
 * Source: https://learn.microsoft.com/en-us/visualstudio/install/workload-component-id-vs-build-tools
 */
const SPECTRE_BY_TOOLSET = Object.freeze({
  '14.29': Object.freeze({
    id: 'Microsoft.VisualStudio.Component.VC.14.29.16.11.x86.x64.Spectre',
    name: 'MSVC v142 - VS 2019 C++ x64/x86 Spectre-mitigated libs (v14.29-16.11)',
  }),
});

/** The confirmed component id for an installed toolset version, or null to mean "use the GUI". */
function spectreComponentFor(toolsetVersion) {
  const m = /^(\d+\.\d+)\./.exec(String(toolsetVersion || ''));
  return (m && SPECTRE_BY_TOOLSET[m[1]]) || null;
}

const SPECTRE = Object.freeze({
  error: 'MSB8040',
  componentName: 'MSVC v142 - VS 2019 C++ x64/x86 Spectre-mitigated libs',
  // CONFIRMED FIRST, per Section 186.6. `…VC.v142.x86.x64.Spectre` used to lead this list and is
  // NOT in Microsoft's published component list for either catalogue — it was my construction, and
  // it is the id master ran against a machine whose toolset is 14.29.30133, which is why nothing
  // installed and nothing complained. The version-pinned ids are the ones that are published.
  componentIds: Object.freeze([
    'Microsoft.VisualStudio.Component.VC.14.29.16.11.x86.x64.Spectre',
  ]),
  installerPath: `${process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'}`
    + '\\Microsoft Visual Studio\\Installer\\vs_installer.exe',
  // The Visual Studio installer writes every run here, prefixed `dd_`. This is the only place that
  // records WHY a modify request installed nothing, and it is where to look when the launcher's
  // exit code says success and the disk says otherwise.
  logs: '%TEMP%\\dd_installer_*.log',
  docs: 'https://learn.microsoft.com/en-us/visualstudio/msbuild/errors/msb8040',
});

/**
 * The commands, in the order a reader should try them.
 *
 * `installPath` is a parameter because the id is not the only thing that varies: the component must
 * be added to the install that node-gyp actually used, and a machine can hold several.
 */
function spectreCommands(installPath = 'C:\\Program Files (x86)\\Microsoft Visual Studio\\2019\\BuildTools') {
  const vsInstaller = SPECTRE.installerPath;
  // DERIVED FROM THE LIST, NOT FROM FIXED INDICES (spec Section 188). This read
  // `componentIds[0]` and `componentIds[1]`, and when Section 186.6 cut the list to the one
  // PUBLISHED id, the second line kept rendering and emitted `--add undefined`. Master's build log
  // printed that command to him. One index outliving its array is the whole defect.
  // `--wait` IS NOT OPTIONAL, and its absence cost two rounds (spec Section 189). `vs_installer.exe`
  // is a LAUNCHER: it hands the request to the setup engine and exits, so the shell reports success
  // before anything has been installed. Master ran the command, saw PowerShell exit cleanly, and
  // the libraries were still absent — the command was telling him about itself, not about the
  // install. With `--wait` the exit code belongs to the actual operation.
  return Object.freeze([
    ...SPECTRE.componentIds.map((id) => `"${vsInstaller}" modify --installPath "${installPath}" `
      + `--add ${id} --passive --norestart --wait`),
    // THE AUTHORITATIVE PATH, said last because it is the one that cannot silently do nothing.
    'Or: open Visual Studio Installer -> Modify -> Individual components -> search "Spectre" -> '
    + `tick "${SPECTRE.componentName}" -> Modify.`,
  ]);
}

/**
 * One entry per module that needs a C++ toolchain, and `whenMissing` is the part that must stay
 * true. Each sentence below was checked against the code that runs when the binding is absent -
 * not against what the fallback was intended to be.
 */
const NATIVE_MODULES = Object.freeze([
  Object.freeze({
    name: 'argon2',
    gives: 'Argon2id key derivation for the credential vault',
    // VERIFIED in `electron/ipc/credentialVault.cjs`: a new vault is sealed with scrypt and flagged
    // `weakKdf`, `vault:status` reports it, Models shows a standing banner and `threatPosture`
    // raises `vault-weak-kdf`. So this one really does degrade and really does say so.
    degrades: true,
    whenMissing: 'The credential vault derives its key with scrypt instead of Argon2id. Contents '
      + 'stay AES-256-GCM encrypted, but a stolen vault file is cheaper to brute-force against.',
    surfacedBy: 'vault:status weakKdf, the Models banner, and the vault-weak-kdf threat signal',
  }),
  Object.freeze({
    name: 'node-pty',
    gives: 'the interactive terminal',
    // VERIFIED in `electron/ipc/terminal.cjs` and `src/pages/Terminal/Terminal.jsx`: there is no
    // child_process fallback. `pty` is null, `terminal:create` returns an error, and the page
    // renders "[Simulated] Command not executed". DO NOT soften this back to "degraded" without
    // building the fallback first - the words were wrong for two tranches precisely because they
    // described an intention instead of the code.
    degrades: false,
    whenMissing: 'The terminal is DISABLED, not degraded: no command runs at all. `terminal:create` '
      + 'refuses, and the Terminal page shows a simulated session that executes nothing.',
    surfacedBy: 'the terminal\u2019s own error on first use, and the startup diagnosis',
  }),
]);

/** Just the names, for a caller that only needs to know which modules are in question. */
const NATIVE_MODULE_NAMES = Object.freeze(NATIVE_MODULES.map((m) => m.name));

/**
 * The consequences of a failed rebuild, as sentences, worst first.
 *
 * A module that stops working entirely is listed before one that falls back, because a reader who
 * stops after the first line should have been told the bigger thing.
 */
function consequences(names = null) {
  // SCOPED TO THE MODULES THAT ACTUALLY FAILED (spec Section 190). This returned BOTH consequences
  // whenever the rebuild step failed as a whole, and master's transcript named only `node-pty` —
  // so he was told his credential vault had fallen back to scrypt when argon2 had loaded fine from
  // its prebuilt Node-API binary all along. A consequence asserted from a build step's exit code
  // rather than from the module's own state is the third false claim in this area after the piped
  // shell (183.1) and `--add undefined` (188). `null` keeps the old whole-set behaviour for callers
  // that genuinely do not know which module failed.
  const wanted = Array.isArray(names) && names.length
    ? NATIVE_MODULES.filter((m) => names.includes(m.name))
    : NATIVE_MODULES.slice();
  return wanted
    .sort((a, b) => Number(a.degrades) - Number(b.degrades))
    .map((m) => `${m.name} did not load. ${m.whenMissing}`);
}

/** The one-line form for a warning stream, which must not claim that anything still works. */
function summaryLine() {
  const dead = NATIVE_MODULES.filter((m) => !m.degrades).map((m) => m.name);
  const weak = NATIVE_MODULES.filter((m) => m.degrades).map((m) => m.name);
  const parts = [];
  // Verb agreement matters here only because this line is read aloud by a build log and a wrong
  // plural makes a reader re-read it instead of acting on it.
  if (dead.length) parts.push(`${dead.join(', ')} ${dead.length === 1 ? 'stops' : 'stop'} working entirely`);
  if (weak.length) parts.push(`${weak.join(', ')} ${weak.length === 1 ? 'falls' : 'fall'} back to something weaker`);
  return parts.join('; ');
}

/** What a reader should do about it. Commands first, prose only where no command exists. */
function remedyLines(installPath) {
  return [
    `On Windows this is almost always the missing "${SPECTRE.componentName}" component `
    + `(node-gyp reports ${SPECTRE.error}). From an ELEVATED prompt:`,
    ...spectreCommands(installPath),
    // WHERE THE ANSWER IS WHEN IT STILL DOES NOTHING. Without this the only evidence available is
    // an exit code that the launcher produces before the work happens.
    `If it reports success and the libraries are still absent, the installer said why in ${SPECTRE.logs} `
    + '— open the newest one and search for "error". Run `npm run doctor:toolchain` to check the '
    + 'libraries on disk rather than trusting the exit code.',
    // Phrased for however many commands there are. It said "if NEITHER command changes anything",
    // which stopped being true the moment the list held one id — and prose that counts its own
    // subject is prose that goes wrong silently (Section 188).
    `Then rebuild. An unrecognised component id installs nothing without failing, so if ${
      SPECTRE.componentIds.length === 1 ? 'that command does' : 'none of those commands do'
    } not change anything, use the GUI.`,
  ];
}

module.exports = {
  SPECTRE,
  SPECTRE_BY_TOOLSET,
  spectreComponentFor,
  NATIVE_MODULES,
  NATIVE_MODULE_NAMES,
  consequences,
  summaryLine,
  remedyLines,
  spectreCommands,
};
