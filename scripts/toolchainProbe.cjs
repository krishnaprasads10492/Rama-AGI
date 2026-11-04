'use strict';

/**
 * toolchainProbe.cjs — which of the four reasons the native rebuild failed (spec Section 186)
 *
 * WHY THIS EXISTS. Section 183 made the rebuild failure say what it COSTS and gave master a command
 * to run. He ran it, and node-gyp still failed — and at that point the project could tell him
 * nothing further, because "MSB8040: Spectre-mitigated libraries are required" has at least four
 * distinct causes with four different fixes:
 *
 *   1. the component was never installed (`vs_installer --add` with an id the catalogue does not
 *      know installs NOTHING and still exits 0, which is why Section 183 offers two ids)
 *   2. it was installed into a DIFFERENT Visual Studio instance from the one node-gyp selected
 *   3. it was installed for a different MSVC toolset than the one building (v143 libs do not
 *      satisfy a v142 build)
 *   4. the failure is no longer MSB8040 at all and the Spectre advice is now a red herring
 *
 * Telling them apart needs the machine, and the machine is master's. So the diagnosis runs THERE,
 * on failure, and prints which case it is. A remedy that cannot distinguish its own failure modes
 * sends a reader round the same loop twice — which is exactly what happened.
 *
 * GROUND TRUTH IS THE FILESYSTEM, NOT THE CATALOGUE. `vswhere -requires <id>` prints a path when an
 * instance has a component and nothing otherwise, but nothing is also what a wrong filter, a
 * Preview instance or an unknown id returns — Microsoft's own vswhere wiki says empty output does
 * not prove absence. The libraries themselves are unambiguous: VS2017 and later put them in
 * `<install>\VC\Tools\MSVC\<toolset>\lib\spectre\<arch>`, and VS2015 in `VC\lib\spectre\amd64`
 * (https://learn.microsoft.com/en-gb/cpp/build/reference/qspectre). So the probe looks for the libs
 * and uses vswhere only to find the instances to look inside.
 *
 * READ-ONLY AND INJECTED. It runs `vswhere.exe -format json` and reads directory names. It installs
 * nothing, changes nothing, and reaches no network — the same refusal `threatPosture.cjs` makes.
 * `exec`, `exists`, `readdir` and `platform` are parameters so every branch, including "no Visual
 * Studio at all", can be driven on a machine that has none.
 */

const path = require('path');

/** Where the installer drops vswhere, which is stable across VS versions. */
const VSWHERE = path.join(
  process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
  'Microsoft Visual Studio', 'Installer', 'vswhere.exe',
);

/**
 * What the machine has.
 *
 * @param {object} io
 * @param {(cmd:string)=>string} io.exec      run a command, return stdout, throw on failure
 * @param {(p:string)=>boolean}  io.exists
 * @param {(p:string)=>string[]} io.readdir
 * @param {string}               io.platform
 * @returns {{verdict:string, instances:Array, spectreFound:Array, reason:string|null}}
 */
function probe({ exec, exists, readdir, platform = process.platform, vswhere = VSWHERE } = {}) {
  if (platform !== 'win32') {
    return { verdict: 'not-windows', instances: [], spectreFound: [], reason: 'this check is Windows-only' };
  }
  if (!exists(vswhere)) {
    // UNKNOWN, NOT ABSENT. No vswhere means the Visual Studio Installer is not present at the usual
    // path; it does not mean there is no compiler. Reporting "no Visual Studio" here would be the
    // comfortable guess that Section 170 D4 forbids.
    return {
      verdict: 'unknown',
      instances: [],
      spectreFound: [],
      reason: `vswhere.exe was not found at ${vswhere}, so the installed Visual Studio instances `
        + 'could not be enumerated',
    };
  }

  let raw;
  try {
    // `-prerelease` and `-products *` because Build Tools and Preview instances are exactly the
    // ones a default query hides, and Build Tools is what this machine builds with.
    raw = exec(`"${vswhere}" -products * -prerelease -format json -utf8`);
  } catch (err) {
    return { verdict: 'unknown', instances: [], spectreFound: [], reason: `vswhere failed: ${err.message}` };
  }

  let parsed;
  try { parsed = JSON.parse(raw); }
  catch { return { verdict: 'unknown', instances: [], spectreFound: [], reason: 'vswhere returned output that is not JSON' }; }
  if (!Array.isArray(parsed)) {
    return { verdict: 'unknown', instances: [], spectreFound: [], reason: 'vswhere returned an unexpected shape' };
  }
  if (parsed.length === 0) {
    return { verdict: 'no-visual-studio', instances: [], spectreFound: [],
      reason: 'vswhere reports no installed Visual Studio instance at all' };
  }

  const instances = [];
  const spectreFound = [];
  for (const inst of parsed) {
    const root = inst && inst.installationPath;
    if (!root) continue;
    const entry = {
      path: root,
      name: inst.displayName || null,
      version: inst.installationVersion || null,
      toolsets: [],
    };

    // VS2017+ layout: one directory per MSVC toolset, each with its own lib tree.
    const msvc = path.join(root, 'VC', 'Tools', 'MSVC');
    if (exists(msvc)) {
      for (const v of readdir(msvc)) {
        const spectre = exists(path.join(msvc, v, 'lib', 'spectre'));
        entry.toolsets.push({ version: v, spectre });
        if (spectre) spectreFound.push({ path: root, toolset: v });
      }
    }
    // VS2015 layout, kept because a machine can hold both and the error is identical.
    const legacy = path.join(root, 'VC', 'lib', 'spectre');
    if (exists(legacy)) {
      entry.toolsets.push({ version: '14.0 (VS2015 layout)', spectre: true });
      spectreFound.push({ path: root, toolset: '14.0' });
    }
    instances.push(entry);
  }

  if (instances.length === 0) {
    return { verdict: 'unknown', instances, spectreFound,
      reason: 'vswhere listed instances but none reported an installation path' };
  }
  // A MACHINE WITH NO C++ TOOLSET IS NOT A MACHINE MISSING THE SPECTRE COMPONENT, and the first
  // run of this probe proved the distinction matters: it found Visual Studio Professional 2026 with
  // nothing under `VC\Tools\MSVC` and then advised ticking "the entry whose toolset matches one
  // listed above" — when none were listed. Telling someone to match a list that is empty is the
  // same class of unhelpful as the remedy this module was written to replace.
  const anyToolset = instances.some((i) => i.toolsets.length > 0);
  let verdict = 'spectre-missing';
  if (spectreFound.length > 0) verdict = 'spectre-present';
  else if (!anyToolset) verdict = 'no-cpp-toolset';

  return { verdict, instances, spectreFound, reason: null };
}

/**
 * The findings as sentences, and the NEXT action for each verdict.
 *
 * `spectre-present` is the interesting one: the libraries exist and the build still failed, so the
 * advice must stop repeating "install the component" — that is the loop this module exists to end.
 */
function lines(findings) {
  const out = ['TOOLCHAIN PROBE — why the native rebuild failed'];
  if (findings.verdict === 'not-windows') {
    out.push('  Not Windows; MSB8040 does not apply here.');
    return out;
  }
  if (findings.verdict === 'unknown') {
    out.push(`  Could not tell: ${findings.reason}`);
    out.push('  So the Spectre advice above is a guess rather than a diagnosis. Check the error text:');
    out.push('  if it does not say MSB8040, the cause is something else entirely.');
    return out;
  }
  if (findings.verdict === 'no-visual-studio') {
    out.push('  No Visual Studio instance is installed, so there is no C++ toolchain to build with.');
    out.push('  Install "Desktop development with C++" (or Build Tools) FIRST — the Spectre');
    out.push('  component is an addition to a toolchain that must already exist.');
    return out;
  }

  out.push(`  ${findings.instances.length} Visual Studio instance(s):`);
  for (const i of findings.instances) {
    const sets = i.toolsets.length
      ? i.toolsets.map((t) => `${t.version}${t.spectre ? ' +spectre' : ' (no spectre libs)'}`).join(', ')
      : 'no MSVC toolset found';
    out.push(`    ${i.name || 'unnamed'} ${i.version || ''} at ${i.path}`);
    out.push(`      toolsets: ${sets}`);
  }

  if (findings.verdict === 'no-cpp-toolset') {
    out.push('  VERDICT: Visual Studio is installed but NO MSVC C++ toolset is, so there is nothing');
    out.push('  for the Spectre libraries to attach to and node-gyp has no compiler to call.');
    out.push('  Install the C++ toolset FIRST — Visual Studio Installer -> Modify -> Workloads ->');
    out.push('  "Desktop development with C++" — then add the Spectre-mitigated libs for the');
    out.push('  toolset it installs. Adding the Spectre component alone will not help.');
    return out;
  }

  if (findings.verdict === 'spectre-missing') {
    out.push('  VERDICT: the Spectre-mitigated libraries are NOT on disk in any instance.');
    out.push('  The vs_installer command above either targeted the wrong --installPath, or used a');
    out.push('  component id this installer\u2019s catalogue does not know — an unknown id installs');
    out.push('  nothing and still exits 0. Use the GUI: Visual Studio Installer -> Modify ->');
    out.push('  Individual components -> search "Spectre" -> tick the entry whose toolset matches');
    out.push('  one listed above -> Modify.');
    return out;
  }

  // spectre-present
  out.push('  VERDICT: the Spectre libraries ARE installed:');
  for (const s of findings.spectreFound) out.push(`    ${s.toolset} in ${s.path}`);
  out.push('  So "install the component" is no longer the answer. One of these is:');
  out.push('    - node-gyp selected a DIFFERENT instance or toolset than the one carrying the libs.');
  out.push('      Pin it: set GYP_MSVS_VERSION, or run npm run rebuild from a Developer Command');
  out.push('      Prompt for the instance listed above as carrying +spectre.');
  out.push('    - the libs are installed for a different ARCHITECTURE than the build targets.');
  out.push('      The GUI entry must be ticked for x64/x86 specifically.');
  out.push('    - the failure is no longer MSB8040. Read the first error line: if it names');
  out.push('      something else, the Spectre advice above does not apply at all.');
  return out;
}

/** The real I/O, kept here so callers do not each assemble it. */
function probeNow() {
  const { execSync } = require('child_process');
  const fs = require('fs');
  return probe({
    exec: (cmd) => execSync(cmd, { encoding: 'utf8', windowsHide: true, timeout: 30_000 }),
    exists: (p) => fs.existsSync(p),
    readdir: (p) => { try { return fs.readdirSync(p); } catch { return []; } },
  });
}

module.exports = { probe, lines, probeNow, VSWHERE };
