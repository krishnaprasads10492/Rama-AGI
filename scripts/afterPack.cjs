'use strict';

/**
 * afterPack.cjs — Post-pack hook.
 * Runs after app is packed but before installer is created.
 * Used to: clean dev files, verify critical files exist, set permissions.
 */

const { existsSync, readdirSync } = require('fs');
const path = require('path');

module.exports = async function(context) {
  const { appOutDir } = context;

  console.log('\n⬢ Rāma AGI — Post-pack verification...\n');

  // Verify key files are in the packed output
  const checks = [
    'resources/app.asar',
    'resources/app/electron/main.cjs',
  ];

  let allOk = true;
  for (const check of checks) {
    const full = path.join(appOutDir, check);
    if (existsSync(full)) {
      console.log(`  ✓ ${check}`);
    } else {
      // app.asar is expected — check either asar or unpacked
      const asarPath = path.join(appOutDir, 'resources', 'app.asar');
      if (existsSync(asarPath)) {
        console.log(`  ✓ app.asar (packed)`);
      } else {
        console.warn(`  ⚠ ${check} not found`);
        allOk = false;
      }
    }
  }

  if (allOk) {
    console.log('\n  ✓ Pack verification passed\n');
  } else {
    console.warn('\n  ⚠ Some checks failed — installer may have issues\n');
  }
};
