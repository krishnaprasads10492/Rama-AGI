'use strict';

/**
 * appearanceState.cjs — persisted zoom, and a first-run fit to the display.
 *
 * TWO PROBLEMS THIS SOLVES, both reported by master from a real machine:
 *
 * 1. Zoom did not survive a restart. `appearance:set-zoom` called
 *    `webContents.setZoomFactor` and nothing wrote the value down, so every
 *    launch reverted to 1.0. Master could enlarge the text and lose it on the
 *    next start, which reads as the setting not working at all.
 *
 * 2. Nothing adapted to the display. The interface is built from inline pixel
 *    values around a 13-14px base. On a large panel running at 100% OS scaling
 *    that is physically tiny, with wide empty margins — which is exactly what
 *    master's screenshot showed.
 *
 * WHY WIDTH IN DIPs IS THE RIGHT SIGNAL: Chromium has already applied the OS
 * scale factor by the time we see `workAreaSize`, so that value is in
 * device-independent pixels. A display reporting a *large* DIP work area is one
 * the OS is NOT scaling — precisely the case that needs help. A 4K panel at 200%
 * reports 1920x1080 DIP and correctly gets no extra scaling, because Windows is
 * already doing it. Reading raw pixels instead would double-scale it.
 *
 * The fit is applied ONCE. The moment master sets a zoom by hand, `source`
 * becomes 'master' and this module never overrides it again — an automatic
 * default may make a first guess, it may not keep overruling a human decision.
 */

const fs   = require('fs');
const path = require('path');

function getStatePath() {
  const { app } = require('electron');
  const base = app?.getPath('userData') || path.join(require('os').homedir(), '.rama-agi');
  fs.mkdirSync(base, { recursive: true });
  return path.join(base, 'appearance.json');
}

const DEFAULTS = {
  zoom:   null,      // null = never decided; the first run fits it to the display
  source: 'unset',   // 'unset' | 'auto' | 'master'
  fittedFor: null,   // { width, height, scaleFactor } the auto fit was computed from
};

// Kept identical to main.cjs's bounds so a persisted value can never place the
// UI outside what the IPC layer would allow.
const ZOOM_MIN = 0.6;
const ZOOM_MAX = 2.0;

// Reference viewport the interface's pixel values were authored against. A
// display materially larger than this in DIPs is under-using the space.
const REF_WIDTH  = 1600;
const REF_HEIGHT = 900;

// Deliberately narrower than ZOOM_MIN/MAX. An automatic guess should never
// shrink the UI (small screens need legible text more, not less) and should stay
// well short of the upper bound, where the fixed-height titlebar starts to clip.
const AUTO_MIN = 1.0;
const AUTO_MAX = 1.4;

function load() {
  try {
    const parsed = JSON.parse(fs.readFileSync(getStatePath(), 'utf8'));
    return { ...DEFAULTS, ...parsed };
  } catch {
    return { ...DEFAULTS };
  }
}

function save(state) {
  try {
    fs.writeFileSync(getStatePath(), JSON.stringify({ ...DEFAULTS, ...state }, null, 2), 'utf8');
    return true;
  } catch {
    return false;   // a lost preference is not worth failing a launch over
  }
}

/**
 * Fit a zoom factor to a display.
 *
 * Scales by the smaller of the width and height ratios, so an ultrawide panel is
 * not enlarged on the strength of its width alone — the limiting dimension is
 * what decides whether content actually fits.
 *
 * @param {{width:number,height:number}} workAreaSize in DIPs
 * @returns {number} rounded to the nearest 0.05
 */
function fitZoomFor(workAreaSize) {
  const w = Number(workAreaSize?.width);
  const h = Number(workAreaSize?.height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return 1;

  const ratio = Math.min(w / REF_WIDTH, h / REF_HEIGHT);
  const clamped = Math.min(AUTO_MAX, Math.max(AUTO_MIN, ratio));
  return Math.round(clamped * 20) / 20;
}

/**
 * The zoom to apply for this launch.
 *
 * @param {{width:number,height:number}} workAreaSize
 * @param {number} [scaleFactor]
 * @returns {{zoom:number, source:'auto'|'master', fitted:boolean}}
 */
function resolveZoom(workAreaSize, scaleFactor = 1) {
  const state = load();

  // Master's own choice is final, on every display, forever.
  if (state.source === 'master' && typeof state.zoom === 'number') {
    return { zoom: clamp(state.zoom), source: 'master', fitted: false };
  }

  const fitted = fitZoomFor(workAreaSize);

  // Re-fit when the display genuinely changed (docked to a monitor, resolution
  // switched) but the value was only ever an automatic guess.
  const prev = state.fittedFor;
  const sameDisplay = prev
    && prev.width === workAreaSize?.width
    && prev.height === workAreaSize?.height
    && prev.scaleFactor === scaleFactor;

  if (state.source === 'auto' && sameDisplay && typeof state.zoom === 'number') {
    return { zoom: clamp(state.zoom), source: 'auto', fitted: false };
  }

  save({
    zoom: fitted,
    source: 'auto',
    fittedFor: {
      width: workAreaSize?.width ?? null,
      height: workAreaSize?.height ?? null,
      scaleFactor,
    },
  });
  return { zoom: fitted, source: 'auto', fitted: true };
}

/** Record a zoom master chose explicitly, which disables further auto-fitting. */
function rememberMasterZoom(zoom) {
  const state = load();
  return save({ ...state, zoom: clamp(zoom), source: 'master' });
}

/** Forget master's override and return to fitting the display. */
function clearMasterZoom() {
  return save({ ...DEFAULTS });
}

function clamp(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 1;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, n));
}

module.exports = {
  load, save, resolveZoom, fitZoomFor, rememberMasterZoom, clearMasterZoom,
  ZOOM_MIN, ZOOM_MAX, AUTO_MIN, AUTO_MAX, REF_WIDTH, REF_HEIGHT,
};
