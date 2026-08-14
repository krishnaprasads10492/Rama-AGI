'use strict';

/**
 * badgeState.cjs — tiny persisted state for the floating status badge.
 *
 * Just two things need to survive a restart: whether the badge is enabled
 * (visible/clickable) and where the master last dragged it. Neither is
 * sensitive, so this is a plain JSON file next to the other small state
 * files in userData, not the encrypted store — the same tier `badge-state.json`
 * lives at as `rama_vault.enc`'s directory, but readable, matching how
 * `app.getLoginItemSettings()`-adjacent preferences are already handled.
 */

const fs   = require('fs');
const path = require('path');

function getStatePath() {
  const { app } = require('electron');
  const base = app?.getPath('userData') || path.join(require('os').homedir(), '.rama-agi');
  fs.mkdirSync(base, { recursive: true });
  return path.join(base, 'badge-state.json');
}

const DEFAULTS = {
  enabled:   true,    // clickable from boot, per master's ask
  pos:       null,    // { x, y } — null means "use the default top-right position"
  hideTray:  false,   // true = no tray icon while running; voice "come back" restores it
};

function load() {
  try {
    const raw = fs.readFileSync(getStatePath(), 'utf8');
    const parsed = JSON.parse(raw);
    return { ...DEFAULTS, ...parsed };
  } catch {
    return { ...DEFAULTS };
  }
}

function save(state) {
  try {
    fs.writeFileSync(getStatePath(), JSON.stringify({ ...DEFAULTS, ...state }, null, 2), 'utf8');
  } catch { /* best effort — a lost position/preference is not worth crashing over */ }
}

module.exports = { load, save };
