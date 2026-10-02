#!/usr/bin/env node
'use strict';

/**
 * verifyBadgeLabel.cjs — the badge may not claim Rāma is paused while Rāma is working.
 *
 * WHAT WENT WRONG. `window-all-closed` deliberately does not quit and `hide` only hides — master
 * confirmed the app SHOULD keep running windowless. In that state `badgeWindow.setStatus('paused')`
 * fired, and the badge was the only visible surface left, so the one indicator master could see
 * reported "paused" while `refreshScheduler` and `metaCognition`'s audit timer kept running.
 *
 * WHAT THIS SUITE REFUSES TO LET SLIDE. A label is a claim about the system, so it is checked against
 * the system: every status label must ENUMERATE the live timers, and each named timer must still
 * exist in source as a real timer. Both halves are needed. Names with no timers behind them is the
 * original defect inverted — a badge confidently listing work that is not happening — and timers with
 * no names is the defect itself.
 *
 * Run: node scripts/verifyBadgeLabel.cjs   (or npm run verify:badge-label)
 */

const fs   = require('fs');
const path = require('path');
const L    = require('../electron/lib/badgeLabel.cjs');

const ROOT = path.join(__dirname, '..');

let pass = 0;
let fail = 0;
const check = (label, ok, detail) => {
  if (ok) { pass += 1; console.log(`  PASS  ${label}`); }
  else { fail += 1; console.log(`  FAIL  ${label}${detail ? ` - ${detail}` : ''}`); }
};

const read = (rel) => {
  try { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }
  catch { return ''; }
};

console.log('\nbadge label — it states what is still running\n');

// ─── the timers it names ──────────────────────────────────────────────────────
console.log('  the timers named in the label');
check('refreshScheduler is named', L.LIVE_TIMERS.includes('refreshScheduler'));
check('the metaCognition audit timer is named', L.LIVE_TIMERS.includes('metaCognition audit timer'));
check('the list is frozen, so a caller cannot quietly shorten it',
  Object.isFrozen(L.LIVE_TIMERS));

const schedSrc = read('electron/lib/refreshScheduler.cjs');
const metaSrc  = read('electron/ipc/metaCognition.cjs');
check('refreshScheduler exists and really schedules on a timer',
  /deps\.setTimer\(/.test(schedSrc) && /function schedule\(/.test(schedSrc));
check('and it is started rather than merely declared',
  /function start\(/.test(schedSrc) && /running = true/.test(schedSrc));
check('the metaCognition audit timer is a real interval',
  /auditTimer\s*=\s*setInterval\(/.test(metaSrc));
check('and it fires on a stated interval rather than on demand',
  /const AUDIT_INTERVAL\s*=/.test(metaSrc));

// The label claims Rāma has not quit. That claim is only true while this handler stays as it is.
const mainSrc = read('electron/main.cjs');
const wacIdx = mainSrc.indexOf("app.on('window-all-closed'");
check('window-all-closed is still handled', wacIdx >= 0);
// Comments stripped first: the handler SAYS "intentionally do NOT call app.quit() here", so reading
// the raw text would fail on the very comment that documents the behaviour being asserted.
const wacBlock = (wacIdx >= 0 ? mainSrc.slice(wacIdx, wacIdx + 400) : '')
  .replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
check('and still does NOT quit, which is what makes the label true',
  wacIdx >= 0 && !/app\.quit\(\)/.test(wacBlock), wacBlock.replace(/\s+/g, ' ').slice(0, 140));

// ─── every label enumerates them ──────────────────────────────────────────────
console.log('\n  every state says what is running');
for (const status of Object.values(L.STATUS)) {
  const text = L.statusLabel(status);
  check(`${status}: names refreshScheduler`, /refreshScheduler/.test(text), text);
  check(`${status}: names the metaCognition audit timer`, /metaCognition audit timer/.test(text), text);
  check(`${status}: says they are still running`, /still running/.test(text), text);
}

const paused = L.statusLabel(L.STATUS.PAUSED);
check('the hidden-window label denies that anything is paused',
  /nothing is paused/i.test(paused), paused);
check('and does not leave "paused" standing on its own as the whole claim',
  paused.replace(/nothing is paused/i, '').toLowerCase().indexOf('paused') === -1, paused);
const closed = L.statusLabel(L.STATUS.CLOSED);
check('the closed label says Rāma has not quit', /has not quit/i.test(closed), closed);
check('the live label is a window statement, not a liveness boast',
  /window open/.test(L.statusLabel(L.STATUS.LIVE)), L.statusLabel(L.STATUS.LIVE));

// ─── the other direction: it must not name timers that are not running ────────
console.log('\n  it does not claim work that is not happening');
const none = L.statusLabel(L.STATUS.PAUSED, []);
check('an empty timer list says nothing is running', /no background timer is running/.test(none), none);
check('and names no timer', !/refreshScheduler|metaCognition/.test(none), none);
check('a non-array is treated as nothing, not as a crash',
  /no background timer is running/.test(L.statusLabel(L.STATUS.PAUSED, null)));
check('blank entries are dropped rather than printed as gaps',
  !/,\s*,/.test(L.statusLabel(L.STATUS.PAUSED, ['refreshScheduler', '', '  '])));
check('one timer reads as one timer',
  L.statusLabel(L.STATUS.PAUSED, ['refreshScheduler']).endsWith('still running: refreshScheduler.'));

// ─── an unknown status ────────────────────────────────────────────────────────
console.log('\n  an unrecognised state');
const unknown = L.statusLabel('wedged');
check('is described as unrecognised rather than shown as live',
  /unrecognised/.test(unknown) && !/window open/.test(unknown), unknown);
check('and still reports the timers, because they are still running',
  /refreshScheduler/.test(unknown), unknown);
check('a missing status does not throw', (() => {
  try { return typeof L.statusLabel(undefined) === 'string'; } catch { return false; }
})());

// ─── the payload and its wiring ───────────────────────────────────────────────
console.log('\n  the payload main actually sends');
const payload = L.statusPayload(L.STATUS.PAUSED);
check('carries the status key the stylesheet needs', payload.status === 'paused');
check('and the label beside it', payload.label === paused);

const winSrc = read('electron/badgeWindow.cjs');
check('badgeWindow builds the payload from this module rather than inline',
  /require\('\.\/lib\/badgeLabel\.cjs'\)/.test(winSrc));
check('and sends it on badge:status',
  /send\('badge:status',\s*label\.statusPayload\(status\)\)/.test(winSrc));
check('no bare status object is sent any more',
  !/send\('badge:status',\s*\{\s*status\s*\}\)/.test(winSrc));
check('the first label is pushed on load, so the markup never has the last word',
  /did-finish-load[\s\S]{0,120}setStatus\(/.test(winSrc));

const htmlSrc = read('electron/badge.html');
check('badge.html reads the label out of the payload',
  /onStatus\(\(\{\s*status,\s*label\s*\}\)/.test(htmlSrc));
check('and shows it as the tooltip, which is the only text master can read',
  /stage\.title\s*=\s*label/.test(htmlSrc));
check('and exposes it to assistive technology too',
  /setAttribute\('aria-label',\s*label\)/.test(htmlSrc));
check('the status still drives the colour class', /classList\.add\(`status-\$\{status\}`\)/.test(htmlSrc));
check('all three colour variants are still styled, so nothing was removed',
  /status-live/.test(htmlSrc) && /status-paused/.test(htmlSrc) && /status-closed/.test(htmlSrc));

const labelSrc = read('electron/lib/badgeLabel.cjs');
check('the label module requires no Electron, so this suite can read it',
  !/require\(['"]electron['"]\)/.test(labelSrc));
check('and holds no timer of its own — it describes, it does not schedule',
  !/setInterval|setTimeout/.test(labelSrc.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')));

console.log(`\n  ${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
