'use strict';

/**
 * bootReport.cjs — write startup failures somewhere master can actually find them.
 *
 * WHY THIS EXISTS. Section 61's boot check reports load failures, missing channels
 * and registration errors through `console.error` and a native dialog. In a packaged
 * app **there is no console**, and a dialog cannot be copied out of easily — so the
 * one thing needed to diagnose the fault (the exact `Cannot find module 'x'` reason
 * strings) was the one thing that could not be retrieved. Six diagnostic rounds were
 * spent asking master to read text back off a screen.
 *
 * A diagnostic that only exists in a place the user cannot reach is not a
 * diagnostic. This writes the whole picture to a plain text file, next to the
 * executable and in userData, and returns the paths so the dialog can name them.
 *
 * Dependency-free — core Node only. It runs when other things have already failed,
 * so it must not be able to fail for the same reason.
 */

const fs   = require('fs');
const os   = require('os');
const path = require('path');

/** Everywhere worth trying, most-findable first. */
function targets(stamp) {
  const name = `rama-boot-failure-${stamp}.txt`;
  const out = [];

  // Beside the executable: the first place anyone looks, and obvious in a portable
  // unpacked build. Often read-only under Program Files, hence the fallbacks.
  try {
    const exeDir = path.dirname(process.execPath);
    out.push(path.join(exeDir, name));
  } catch { /* no execPath */ }

  try {
    const app = require('electron').app;
    const userData = app?.getPath('userData');
    if (userData) out.push(path.join(userData, name));
    const desktop = app?.getPath('desktop');
    if (desktop) out.push(path.join(desktop, name));
  } catch { /* electron unavailable */ }

  out.push(path.join(os.tmpdir(), name));
  return out;
}

/**
 * @param {object} ctx
 * @param {string}   [ctx.phase]                 where it went wrong
 * @param {Error}    [ctx.error]                 the throw, if there was one
 * @param {Array}    [ctx.loadFailures]          safeRequire's record
 * @param {Array}    [ctx.registrationFailures]  {label, error}
 * @param {string[]} [ctx.missingChannels]
 * @param {string[]} [ctx.stubbed]
 * @param {Set|Array}[ctx.registeredChannels]
 * @returns {{written:string[], text:string}}
 */
function write(ctx = {}) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const text  = render(ctx, stamp);
  const written = [];

  for (const target of targets(stamp)) {
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, text, 'utf8');
      written.push(target);
    } catch { /* try the next location */ }
  }
  return { written, text };
}

function render(ctx, stamp) {
  const L = [];
  const add = (s = '') => L.push(s);

  add('RAMA AGI — STARTUP FAILURE REPORT');
  add('='.repeat(72));
  add(`when        : ${new Date().toISOString()}`);
  add(`phase       : ${ctx.phase || 'unknown'}`);
  add('');

  add('ENVIRONMENT');
  add('-'.repeat(72));
  try {
    const app = require('electron').app;
    add(`packaged    : ${app?.isPackaged}`);
    add(`appPath     : ${app?.getAppPath?.()}`);
    add(`version     : ${app?.getVersion?.()}`);
  } catch { add('packaged    : unknown (electron app unavailable)'); }
  add(`execPath    : ${process.execPath}`);
  add(`__dirname   : ${__dirname}`);
  add(`node        : ${process.versions.node}`);
  add(`electron    : ${process.versions.electron || 'n/a'}`);
  add(`platform    : ${process.platform} ${process.arch}`);
  add('');

  // The whole point of the file: full, untruncated reasons.
  const loads = ctx.loadFailures || [];
  add(`MODULE LOAD FAILURES (${loads.length})`);
  add('-'.repeat(72));
  if (loads.length === 0) add('  none');
  for (const f of loads) {
    add(`  ${f.name || f.label || '?'}`);
    add(`      reason: ${f.reason || f.error || 'unstated'}`);
    if (f.stack) {
      for (const line of String(f.stack).split('\n').slice(0, 6)) add(`      ${line.trim()}`);
    }
  }
  add('');

  const regs = ctx.registrationFailures || [];
  add(`IPC REGISTRATION FAILURES (${regs.length})`);
  add('-'.repeat(72));
  if (regs.length === 0) add('  none');
  for (const r of regs) add(`  ${r.label}: ${r.error}`);
  add('');

  add('BOOT-CRITICAL CHANNELS');
  add('-'.repeat(72));
  const missing = ctx.missingChannels || [];
  add(`  missing: ${missing.length ? missing.join(', ') : 'none'}`);
  const chans = ctx.registeredChannels instanceof Set
    ? [...ctx.registeredChannels] : (ctx.registeredChannels || []);
  add(`  registered total: ${chans.length}`);
  add(`  session:* present: ${chans.filter(c => String(c).startsWith('session:')).join(', ') || 'NONE'}`);
  add('');

  add('SUBSYSTEMS REPLACED BY A STUB');
  add('-'.repeat(72));
  add(`  ${(ctx.stubbed || []).join(', ') || 'none'}`);
  add('');

  // Resolvability of the things the boot path needs, checked from here rather than
  // assumed — this is what distinguishes "not packaged" from "failed to execute".
  add('BOOT PATH RESOLUTION CHECK');
  add('-'.repeat(72));
  const CHECKS = [
    '../sessionManager.cjs', '../cryptoCore.cjs', '../dataStore.cjs',
    '../nucleusSealer.cjs', '../genome.cjs', './safeRequire.cjs',
    './capability.cjs', './loyaltyGuard.cjs', './loyaltyCore.cjs',
    './selfRepair.cjs', './crashGuard.cjs', './startupDoctor.cjs',
    '../../shared/capabilities.json', '../../package-lock.json',
  ];
  for (const rel of CHECKS) {
    let state;
    try { require.resolve(path.join(__dirname, rel)); state = 'resolves'; }
    catch (e) { state = `NOT FOUND (${e.code || e.message})`; }
    add(`  ${rel.padEnd(34)} ${state}`);
  }
  add('');

  add('RUNTIME PACKAGE CHECK');
  add('-'.repeat(72));
  for (const pkg of ['express', 'cors', 'helmet', 'express-rate-limit', 'debug',
    'simple-git', 'axios', 'systeminformation', 'uuid', 'electron-updater',
    'follow-redirects', 'node-gyp-build', 'argon2']) {
    let state;
    try { require.resolve(pkg); state = 'resolves'; }
    catch (e) { state = `NOT FOUND (${e.code || e.message})`; }
    add(`  ${pkg.padEnd(22)} ${state}`);
  }
  add('');

  if (ctx.error) {
    add('THROW');
    add('-'.repeat(72));
    add(`  ${ctx.error.message}`);
    add('');
    add(String(ctx.error.stack || '').split('\n').map(l => `  ${l}`).join('\n'));
    add('');
  }

  add('='.repeat(72));
  add('Send this whole file. It contains no passcode, no key and no file contents —');
  add('only module names, channel names and resolution results.');
  add(`report id: ${stamp}`);
  return L.join('\n');
}

module.exports = { write, render };
