#!/usr/bin/env node
'use strict';

/**
 * publishToChannel.cjs — post-build step: put the build where installs can find it (Section 84).
 *
 * Usage:
 *   node scripts/publishToChannel.cjs [--dir <path>] [--keep 3] [--notes "text"] [--allow-stale]
 *   npm run publish:channel
 *
 * Resolution order for the destination: `--dir`, then `RAMA_UPDATE_CHANNEL_DIR`, then a default of
 * `dist-electron/channel` **in the repo**. The repo default is deliberate for the CLI: run from a
 * checkout with no env set, the least surprising place to write is next to the build, not into some
 * install's userData that this process knows nothing about. The in-app publisher resolves userData
 * instead, because there it is known.
 *
 * WHY IT REUSES `classifyArtifacts` FROM THE SELF-BUILD PIPELINE. `dist-electron/` accumulates, and
 * publishing a leftover artefact from a previous or FAILED run would push an older build into the
 * channel where every install would then offer it as an update. That selection rule is already
 * written and tested once (Section 83); a second copy here could drift from it. `--allow-stale`
 * exists for the deliberate case of publishing a build made earlier, and it says so in the output.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const channel = require(path.join(ROOT, 'electron', 'lib', 'updateChannel.cjs'));
const pipeline = require(path.join(ROOT, 'electron', 'lib', 'selfBuildPipeline.cjs'));

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? (argv[i + 1] ?? true) : null;
};
const has = (name) => argv.includes(`--${name}`);

function main() {
  if (has('help')) {
    process.stdout.write(
      'publishToChannel — copy the freshly built artefact into an update channel folder\n\n'
      + '  --dir <path>     destination (else RAMA_UPDATE_CHANNEL_DIR, else dist-electron/channel)\n'
      + '  --keep <n>       how many artefacts to retain (default 3)\n'
      + '  --notes "text"   release notes recorded in the manifest\n'
      + '  --allow-stale    publish the newest artefact even if it predates this invocation\n');
    return 0;
  }

  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const version = pkg.version;
  const product = pkg.build?.productName || pkg.productName || pkg.name;

  const dest = channel.channelDir({
    override: flag('dir') || null,
    userDataPath: null,
  }) || path.join(ROOT, 'dist-electron', 'channel');

  const outDir = path.join(ROOT, pipeline.OUTPUT_DIR);
  if (!fs.existsSync(outDir)) {
    process.stderr.write(`✕ ${pipeline.OUTPUT_DIR}/ does not exist — build first\n`);
    return 1;
  }

  const entries = fs.readdirSync(outDir).map((name) => {
    const st = fs.statSync(path.join(outDir, name));
    return { name, size: st.size, mtimeMs: st.mtimeMs, isDirectory: st.isDirectory() };
  });

  // `--allow-stale` widens the window to "anything"; otherwise only what this build produced.
  // A 5 minute grace lets `npm run package:win && npm run publish:channel` work as one thought.
  const since = has('allow-stale') ? 0 : Date.now() - 5 * 60 * 1000;
  const scan = pipeline.classifyArtifacts(entries, since);

  const chosen = scan.installer || scan.portable;
  if (!chosen) {
    process.stderr.write(
      `✕ no installer or archive produced in the last 5 minutes in ${pipeline.OUTPUT_DIR}/.\n`
      + (scan.stale.length
        ? `  Older output is present (${scan.stale.map((a) => a.name).join(', ')}).\n`
          + '  Re-run the build, or pass --allow-stale to publish one of those deliberately.\n'
        : '  Build first.\n'));
    return 1;
  }

  if (!scan.installer && scan.portable) {
    process.stdout.write(
      '! Only an archive was produced, not an installer. Publishing it so installs can SEE the\n'
      + '  release, but Rāma cannot replace an installed copy from an archive — that is the\n'
      + '  7-Zip-blocked case from Section 45.\n');
  }

  const res = channel.publish({
    artefactPath: path.join(outDir, chosen.name),
    dir: dest,
    version,
    product,
    notes: typeof flag('notes') === 'string' ? flag('notes') : null,
    keep: Number(flag('keep')) || undefined,
  });

  if (!res.ok) {
    process.stderr.write(`✕ ${res.error}\n`);
    return 1;
  }

  process.stdout.write(
    `✓ published ${res.manifest.version} → ${res.dir}\n`
    + `  ${res.manifest.file}  ${(res.manifest.sizeBytes / 1048576).toFixed(1)} MB  `
    + `${res.manifest.kind}\n`
    + `  sha256 ${res.manifest.sha256.slice(0, 16)}…\n`
    + (res.pruned.length ? `  pruned ${res.pruned.join(', ')}\n` : '')
    + '\n  An installed Rāma pointed at this folder will offer it under GitSync → UPDATE.\n'
    + '  Reminder: whoever can write to that folder can make Rāma run their executable, so keep\n'
    + '  it somewhere you control.\n');
  return 0;
}

process.exit(main());
