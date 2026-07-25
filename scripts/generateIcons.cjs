'use strict';

/**
 * generateIcons.cjs — Generate all icon formats from logo-source.png
 *
 * Run: node scripts/generateIcons.cjs
 *
 * Requires: npm install sharp png-to-ico --save-dev
 *
 * Reads:  assets/logo-source.png  (your master logo — any size, ideally 1024x1024+)
 * Writes:
 *   assets/icon.png        512x512  PNG   (Linux, macOS fallback)
 *   assets/icon-256.png    256x256  PNG
 *   assets/icon-128.png    128x128  PNG
 *   assets/icon-64.png      64x64   PNG
 *   assets/icon-32.png      32x32   PNG
 *   assets/icon-16.png      16x16   PNG
 *   assets/icon.ico         Multi-size ICO (256,128,64,48,32,16) for Windows
 *   assets/icon.icns        Apple ICNS for macOS
 *   public/icon.png         512x512 for Electron tray (web-accessible)
 *   public/favicon.ico      Favicon for the HTML page
 */

const path   = require('path');
const fs     = require('fs');

const ROOT   = path.join(__dirname, '..');
const ASSETS = path.join(ROOT, 'assets');
const PUBLIC = path.join(ROOT, 'public');
const SOURCE = path.join(ASSETS, 'logo-source.png');

// ANSI
const G = '\x1b[32m', R = '\x1b[31m', C = '\x1b[36m', D = '\x1b[2m', X = '\x1b[0m';
const ok  = (m) => console.log(`${G}✓${X} ${m}`);
const err = (m) => console.log(`${R}✕${X} ${m}`);
const log = (m) => console.log(`${C}⬢${X} ${m}`);

async function main() {
  console.log(`\n${C}⬢ Rāma AGI — Icon Generator${X}\n`);

  // Check source exists
  if (!fs.existsSync(SOURCE)) {
    err(`Source not found: ${SOURCE}`);
    err('Save the Rāma logo as assets/logo-source.png first');
    process.exit(1);
  }
  ok(`Source: ${SOURCE}`);

  // Check sharp
  let sharp;
  try {
    sharp = require('sharp');
  } catch {
    err('sharp not installed — run: npm install sharp --save-dev');
    process.exit(1);
  }

  // Check png-to-ico
  let pngToIco;
  try {
    pngToIco = require('png-to-ico');
  } catch {
    err('png-to-ico not installed — run: npm install png-to-ico --save-dev');
    process.exit(1);
  }

  fs.mkdirSync(ASSETS, { recursive: true });
  fs.mkdirSync(PUBLIC, { recursive: true });

  // ── PNG sizes ────────────────────────────────────────────────────────────
  const pngSizes = [512, 256, 128, 64, 48, 32, 16];
  const pngFiles = {};

  log('Generating PNG sizes...');
  for (const size of pngSizes) {
    const outPath = size === 512
      ? path.join(ASSETS, 'icon.png')
      : path.join(ASSETS, `icon-${size}.png`);

    await sharp(SOURCE)
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toFile(outPath);

    pngFiles[size] = outPath;
    ok(`  icon-${size}.png`);
  }

  // Copy 512 to public/
  fs.copyFileSync(pngFiles[512], path.join(PUBLIC, 'icon.png'));
  ok('public/icon.png');

  // ── Windows ICO (multi-size: 256, 128, 64, 48, 32, 16) ──────────────────
  log('Generating icon.ico (Windows)...');
  try {
    const icoSizes   = [256, 128, 64, 48, 32, 16];
    const icoBuffers = icoSizes.map(s => fs.readFileSync(pngFiles[s] || pngFiles[32]));
    const icoBuffer  = await pngToIco(icoBuffers);
    const icoPath    = path.join(ASSETS, 'icon.ico');
    fs.writeFileSync(icoPath, icoBuffer);
    ok(`icon.ico (${(icoBuffer.length / 1024).toFixed(0)} KB, ${icoSizes.join('+')}px)`);

    // Also write favicon
    const faviconBuffer = await pngToIco([fs.readFileSync(pngFiles[32])]);
    fs.writeFileSync(path.join(PUBLIC, 'favicon.ico'), faviconBuffer);
    ok('public/favicon.ico');
  } catch (e) {
    err(`ICO generation failed: ${e.message}`);
  }

  // ── macOS ICNS ──────────────────────────────────────────────────────────
  log('Generating icon.icns (macOS)...');
  try {
    // ICNS format: use png2icons if available, otherwise write a note
    let png2icons;
    try {
      png2icons = require('png2icons');
    } catch {
      // png2icons not installed — write a placeholder and note
      fs.writeFileSync(path.join(ASSETS, 'icon.icns'), '');
      log(`${D}  ICNS: install png2icons for proper macOS icon: npm install png2icons --save-dev${X}`);
      log(`${D}  Alternatively: use iconutil on macOS to convert from PNG${X}`);
      ok('icon.icns (placeholder — see note above)');
      return;
    }

    const srcBuffer  = fs.readFileSync(SOURCE);
    const icnsBuffer = png2icons.createICNS(srcBuffer, png2icons.BILINEAR, 0);
    if (icnsBuffer) {
      fs.writeFileSync(path.join(ASSETS, 'icon.icns'), icnsBuffer);
      ok(`icon.icns (${(icnsBuffer.length / 1024).toFixed(0)} KB)`);
    } else {
      throw new Error('png2icons returned null');
    }
  } catch (e) {
    err(`ICNS generation failed: ${e.message}`);
    log(`${D}  On macOS: iconutil -c icns assets/icon.iconset (after creating iconset)${X}`);
  }

  // ── Summary ─────────────────────────────────────────────────────────────
  console.log(`\n${G}✓ Icon generation complete!${X}\n`);
  console.log(`${D}  Files in assets/:${X}`);
  const files = fs.readdirSync(ASSETS).filter(f => f.startsWith('icon'));
  files.forEach(f => {
    const size = fs.statSync(path.join(ASSETS, f)).size;
    console.log(`${D}    ${f} (${(size/1024).toFixed(1)} KB)${X}`);
  });
  console.log(`\n${C}  Now run: npm run build:win${X}\n`);
}

main().catch(err => {
  console.error(`\n${R}Fatal: ${err.message}${X}`);
  process.exit(1);
});
