'use strict';

/**
 * badgeWindow.cjs — the always-on-top floating status badge.
 *
 * WHAT THIS IS: master asked for a small persistent presence indicator that
 * survives from boot to shutdown, separate from the main window, showing
 * whether Rāma is live/paused/closed-but-listening, draggable, and toggled
 * by voice ("enable"/"disable" + casual synonyms — matched in
 * src/services/voiceEngine.js, orchestrated from electron/main.cjs).
 *
 * WHY A SEPARATE BrowserWindow rather than a corner of the main window:
 * the whole point is that it outlives the main window being hidden/minimized
 * — Electron does not support "always show this one region of a hidden
 * window," so a second small frameless window is the only mechanism that
 * can be on top of everything while the main window is gone from the
 * taskbar entirely.
 *
 * WHAT THIS MODULE OWNS: the BrowserWindow itself, its position (persisted
 * via lib/badgeState.cjs), and pushing status updates to it. It deliberately
 * does NOT own the tray icon or the main window's show/hide — main.cjs
 * already owns both of those, so the enable/disable orchestration
 * (show/hide badge + tray + optionally the main window) lives there to
 * avoid a circular require and a second source of truth over the same
 * BrowserWindow/Tray objects.
 */

const { BrowserWindow, screen } = require('electron');
const path  = require('path');
const state = require('./lib/badgeState.cjs');

const SIZE   = 72;     // square window — enough for the orb + status ring + glow
const MARGIN = 20;     // default distance from the screen edge

let badgeWin   = null;
let saveTimer  = null;

/** Default top-right corner of whatever display currently has the cursor/primary. */
function defaultPosition() {
  const { workArea } = screen.getPrimaryDisplay();
  return {
    x: workArea.x + workArea.width  - SIZE - MARGIN,
    y: workArea.y + MARGIN,
  };
}

/** A saved position is only trusted if it still lands on a connected display. */
function resolvePosition() {
  const saved = state.load().pos;
  if (!saved || typeof saved.x !== 'number' || typeof saved.y !== 'number') {
    return defaultPosition();
  }
  const onScreen = screen.getAllDisplays().some(d =>
    saved.x >= d.bounds.x - SIZE && saved.x <= d.bounds.x + d.bounds.width
    && saved.y >= d.bounds.y - SIZE && saved.y <= d.bounds.y + d.bounds.height
  );
  return onScreen ? saved : defaultPosition();
}

function persistPosition(pos) {
  clearTimeout(saveTimer);
  // Dragging fires many 'moved' events per second — debounce so this isn't a
  // disk write per pixel.
  saveTimer = setTimeout(() => {
    const current = state.load();
    state.save({ ...current, pos });
  }, 400);
}

/**
 * @param {object} opts
 * @param {() => void} opts.onClick    called when the badge is clicked while enabled
 */
function create({ onClick } = {}) {
  if (badgeWin && !badgeWin.isDestroyed()) return badgeWin;

  const { x, y } = resolvePosition();

  badgeWin = new BrowserWindow({
    x, y,
    width:            SIZE,
    height:           SIZE,
    frame:            false,
    transparent:      true,
    resizable:        false,
    movable:          true,
    minimizable:      false,
    maximizable:      false,
    fullscreenable:   false,
    alwaysOnTop:      true,
    skipTaskbar:      true,      // the badge itself is never a taskbar entry
    hasShadow:        false,
    show:             false,      // shown explicitly once state.enabled is known
    webPreferences: {
      preload:          path.join(__dirname, 'badgePreload.cjs'),
      contextIsolation: true,
      nodeIntegration:  false,
      sandbox:          false,
    },
  });

  badgeWin.setAlwaysOnTop(true, 'screen-saver');   // stays above fullscreen apps too
  badgeWin.loadFile(path.join(__dirname, 'badge.html'));

  badgeWin.on('moved', () => {
    if (!badgeWin || badgeWin.isDestroyed()) return;
    const [px, py] = badgeWin.getPosition();
    persistPosition({ x: px, y: py });
  });

  badgeWin.on('closed', () => { badgeWin = null; });

  const { ipcMain } = require('electron');
  ipcMain.removeAllListeners('badge:clicked');
  ipcMain.on('badge:clicked', () => onClick?.());

  if (state.load().enabled) {
    badgeWin.showInactive();   // present, but does not steal focus from whatever was frontmost
  }

  return badgeWin;
}

function show() {
  if (!badgeWin || badgeWin.isDestroyed()) return;
  badgeWin.showInactive();
}

/** True hide — window leaves the screen entirely. Not used by setEnabled;
 * kept for before-quit cleanup and any future "fully disappear" need. */
function hide() {
  if (!badgeWin || badgeWin.isDestroyed()) return;
  badgeWin.hide();
}

/** @param {'live'|'paused'|'closed'} status */
function setStatus(status) {
  if (!badgeWin || badgeWin.isDestroyed()) return;
  badgeWin.webContents.send('badge:status', { status });
}

function destroy() {
  clearTimeout(saveTimer);
  if (badgeWin && !badgeWin.isDestroyed()) badgeWin.destroy();
  badgeWin = null;
}

function isEnabled() { return !!state.load().enabled; }

/**
 * Enabled/disabled is about CLICKABILITY, not visibility or status — the
 * badge stays on screen the whole time ("always present... till close" per
 * the ask), and its live/paused/closed status (set via setStatus, driven by
 * main.cjs's actual app-lifecycle state) is a separate, independent axis.
 * Disabled = click-through (mouse events pass to whatever is underneath).
 * Re-enabling restores normal click handling.
 */
function setEnabled(enabled) {
  const current = state.load();
  state.save({ ...current, enabled: !!enabled });
  if (!badgeWin || badgeWin.isDestroyed()) return;

  badgeWin.setIgnoreMouseEvents(!enabled, enabled ? undefined : { forward: true });
}

module.exports = { create, show, hide, setStatus, destroy, isEnabled, setEnabled };
