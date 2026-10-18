'use strict';

/**
 * engineEnv.cjs - where the StockMind engine keeps its data, and what environment it starts with (spec Section 154)
 *
 * THE PROBLEM THIS CLOSES. Nothing set `STOCKMIND_DATA_DIR` or `STOCKMIND_MODELS_DIR`, so an installed app wrote
 * bars, the ledger, the strategy book, news and trained models under `resources/ai_backend/data`: inside the
 * install directory, which is read-only under Program Files and is replaced by an upgrade. The build notes
 * already said this data belongs in userData.
 *
 * THE RULE. A PACKAGED app keeps engine data under `<userData>/stockmind/{history,models}`. A source checkout
 * keeps using `ai_backend/data` exactly as before, so a developer's stored series do not vanish. An explicit
 * variable always wins, so a machine that already points these elsewhere is untouched.
 *
 * MIGRATION COPIES, NEVER MOVES. The first packaged run copies the old directories across if the new ones do
 * not exist yet, and leaves the originals where they were. A marker records that it happened so it is not
 * repeated. Losing someone's stored history to "tidying" is not recoverable; a duplicate is.
 *
 * UTF-8. The engine's console output carries non-ASCII text (names, arrows) and a Windows code page crashed three
 * test modules on it. The engine is started in UTF-8 mode so a log line cannot take a route down.
 */

const fs = require('fs');
const path = require('path');

const MARKER = '.migrated-from-install-dir';

function dirs(userData) {
  const root = path.join(userData, 'stockmind');
  return { root, history: path.join(root, 'history'), models: path.join(root, 'models') };
}

/**
 * @param {object} baseEnv  process.env
 * @param {{isPackaged:boolean, userData:string|null}} ctx
 * @returns {{env:object, dataDir:string|null, modelsDir:string|null, relocated:boolean}}
 */
function build(baseEnv, ctx) {
  const env = { ...baseEnv, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' };
  const wantsRelocation = !!(ctx && ctx.isPackaged && ctx.userData);
  let dataDir = env.STOCKMIND_DATA_DIR || null;
  let modelsDir = env.STOCKMIND_MODELS_DIR || null;
  let relocated = false;
  if (wantsRelocation) {
    const d = dirs(ctx.userData);
    if (!dataDir) { dataDir = d.history; env.STOCKMIND_DATA_DIR = dataDir; relocated = true; }
    if (!modelsDir) { modelsDir = d.models; env.STOCKMIND_MODELS_DIR = modelsDir; relocated = true; }
  }
  return { env, dataDir, modelsDir, relocated };
}

function copyTree(src, dest, fsApi) {
  fsApi.mkdirSync(dest, { recursive: true });
  let files = 0;
  for (const name of fsApi.readdirSync(src)) {
    const from = path.join(src, name);
    const to = path.join(dest, name);
    const st = fsApi.statSync(from);
    if (st.isDirectory()) files += copyTree(from, to, fsApi);
    else if (!fsApi.existsSync(to)) { fsApi.copyFileSync(from, to); files += 1; }
  }
  return files;
}

/**
 * Copy the old install-directory data to the new location once.
 * @returns {{ok:boolean, copied:number, skipped?:string, error?:string}}
 */
function migrate(backendPath, target, fsApi = fs) {
  try {
    if (!target || !target.dataDir || !backendPath) return { ok: true, copied: 0, skipped: 'nothing to migrate to' };
    const marker = path.join(path.dirname(target.dataDir), MARKER);
    if (fsApi.existsSync(marker)) return { ok: true, copied: 0, skipped: 'already migrated' };
    const oldHistory = path.join(backendPath, 'data', 'history');
    const oldModels = path.join(backendPath, 'data', 'models');
    let copied = 0;
    // File by file, and NEVER over a file that already exists there. That makes an interrupted migration
    // resumable (the marker is written last) and means data the new location already holds always wins.
    if (fsApi.existsSync(oldHistory)) copied += copyTree(oldHistory, target.dataDir, fsApi);
    if (target.modelsDir && fsApi.existsSync(oldModels)) copied += copyTree(oldModels, target.modelsDir, fsApi);
    fsApi.mkdirSync(path.dirname(marker), { recursive: true });
    fsApi.writeFileSync(marker, new Date().toISOString());
    return { ok: true, copied };
  } catch (err) {
    // A failed migration must not stop the engine from starting: it starts empty and says so.
    return { ok: false, copied: 0, error: err.message };
  }
}

module.exports = { build, migrate, dirs, MARKER };
