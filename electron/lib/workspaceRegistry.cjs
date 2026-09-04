'use strict';

/**
 * workspaceRegistry.cjs — the one authority for what master works on (spec Section 86).
 *
 * THE DEFECT THIS EXISTS TO FIX. Every surface held its own path and asked independently:
 * `GitSync` had `repoPath` in `useState('')`, the IDE's `FileTree` had its own `cwd`, StockMind its
 * own symbol. Nothing was shared and nothing was remembered, so master re-selected the same folder
 * every single time he opened a page. That is not a UI annoyance, it is a missing abstraction:
 * there was no place in Rāma that knew what its own workspace was.
 *
 * This is that place. Pages read from it instead of asking, a project registers itself when Rāma
 * creates it, and anything that opens a folder records the fact.
 *
 * ─── ON THE NAME ─────────────────────────────────────────────────────────────
 *
 * Master proposed calling this a "nucleus" with everything else as cells attached to it, and the
 * SHAPE of that is exactly right — one shared context, many consumers. The name is deliberately
 * NOT "nucleus": Rāma already has one (`nucleusSealer.cjs`, `loyaltyCore.cjs`, invariants I15/I16)
 * holding the sealed loyalty core, and that is the single part of this codebase that must never be
 * confused with anything else. A later session conflating a list of folder paths with the loyalty
 * envelope is a real hazard, so the word stays reserved.
 *
 * It is also not called "ASI". It is a registry of paths with self-detection. Section 36 declined
 * five architecture-poster claims that had no engineering referent; naming this after a capability
 * it does not have would be the sixth.
 *
 * ─── DESIGN ──────────────────────────────────────────────────────────────────
 *
 * `dataStore`'s `config` domain, encrypted at rest, same as every other setting — no new storage
 * mechanism (I9's spirit: one authority per concern).
 *
 * `dataStore` is INJECTED rather than required at module load, so every rule below is testable
 * under plain node with no Electron — the same reason Sections 80 and 84 inject their context.
 */

const fs = require('fs');
const path = require('path');

const DOMAIN = 'config';
const KEY = 'workspaceProjects';

// Bounded so the list stays useful rather than becoming a history dump. Pinned entries are never
// evicted — a favourite is master's explicit statement that it matters.
const MAX_ENTRIES = 60;

const KINDS = ['git', 'node', 'react', 'electron', 'python', 'static', 'folder'];

let injected = null;

/** Inject the store. `main.cjs` does this once at registration. */
function useStore(store) { injected = store; }

function ds() {
  if (injected) return injected;
  // Lazy require so importing this module never needs Electron.
  return require('../dataStore.cjs');
}

/**
 * A stable identity for a folder.
 *
 * DEDUPED ON A NORMALISED, CASE-FOLDED PATH. Windows treats `C:\Repo` and `c:\repo\` as the same
 * directory, and a trailing separator changes the string but not the folder. Without this the same
 * project appears two or three times in the list and "recent" becomes meaningless.
 */
function keyFor(p) {
  if (!p || typeof p !== 'string') return null;
  let r;
  try { r = path.resolve(p.trim()); } catch { return null; }
  if (!r) return null;
  // Strip a trailing separator except on a drive root (`C:\`).
  if (r.length > 3 && (r.endsWith(path.sep) || r.endsWith('/'))) r = r.slice(0, -1);
  return process.platform === 'win32' ? r.toLowerCase() : r;
}

/**
 * What kind of project is this? Read from disk, never guessed from the name.
 *
 * The point of self-detection is that master should not have to tell Rāma what he just opened.
 * Order matters: the most specific signal wins, so an Electron app is not merely "node".
 */
function detect(dir) {
  const out = { kind: 'folder', isGit: false, signals: [], name: null };
  if (!dir) return out;
  let entries = [];
  try {
    if (!fs.statSync(dir).isDirectory()) return out;
    entries = fs.readdirSync(dir);
  } catch {
    return out;
  }
  const has = (n) => entries.includes(n);
  out.name = path.basename(path.resolve(dir)) || null;
  out.isGit = has('.git');
  if (out.isGit) out.signals.push('.git');

  // `hasPkg` is tracked separately from `pkg` deliberately. A folder containing a package.json IS
  // a node project even when that file is malformed — the file's PRESENCE is the signal, and
  // parsing only supplies the name and dependencies. Testing `pkg` instead of `hasPkg` conflated
  // "parsed successfully" with "is a node project", so a project with one stray comma in its
  // package.json was reported as a plain folder.
  const hasPkg = has('package.json');
  let pkg = null;
  if (hasPkg) {
    out.signals.push('package.json');
    try {
      pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
      if (pkg?.name) out.name = pkg.name;
    } catch { /* malformed, but still a node project */ }
  }

  const dep = (n) => !!(pkg?.dependencies?.[n] || pkg?.devDependencies?.[n]);

  if (dep('electron') || pkg?.build?.appId) {
    out.kind = 'electron';
  } else if (dep('react') || dep('next') || dep('vite')) {
    out.kind = 'react';
  } else if (hasPkg) {
    out.kind = 'node';
  } else if (has('requirements.txt') || has('pyproject.toml') || has('setup.py')
    || has('Pipfile')) {
    out.kind = 'python';
    out.signals.push(has('pyproject.toml') ? 'pyproject.toml' : 'requirements.txt');
  } else if (has('index.html')) {
    out.kind = 'static';
    out.signals.push('index.html');
  } else if (out.isGit) {
    out.kind = 'git';
  }
  return out;
}

function readAll() {
  try {
    const raw = ds().get(DOMAIN, KEY);
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function writeAll(rows) {
  try {
    ds().set(DOMAIN, KEY, rows);
    ds().saveDomain?.(DOMAIN);
    return true;
  } catch {
    return false;
  }
}

/**
 * Order: pinned first, then most recently opened.
 *
 * `missing` entries sink to the bottom but are NOT hidden, because a folder on an unmounted drive
 * is still a project master cares about and silently dropping it from the list would look like data
 * loss.
 */
function sortRows(rows) {
  return [...rows].sort((a, b) => {
    if (!!a.missing !== !!b.missing) return a.missing ? 1 : -1;
    if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
    return String(b.lastOpened || '').localeCompare(String(a.lastOpened || ''));
  });
}

/**
 * Every known project, with liveness checked at read time.
 *
 * A MISSING PATH IS MARKED, NOT DELETED. An unmounted network share, a USB drive, a folder renamed
 * for an afternoon — pruning on absence would quietly erase a pinned favourite and master would
 * have no idea why. He removes things; Rāma only reports.
 */
function list({ checkExists = true } = {}) {
  const rows = readAll().map((r) => {
    const exists = checkExists ? fs.existsSync(r.path) : !r.missing;
    return { ...r, missing: !exists };
  });
  return sortRows(rows);
}

function find(p) {
  const k = keyFor(p);
  if (!k) return null;
  return readAll().find((r) => r.key === k) || null;
}

/**
 * Record a project, or update what is known about one.
 *
 * Idempotent by design: opening the same folder for the hundredth time updates `lastOpened` and
 * nothing else. `createdByRama` is sticky once set — it records history, and a later plain open
 * must not erase the fact that Rāma made it.
 */
function register({ path: p, name = null, kind = null, createdByRama = false,
  pinned = null, note = null } = {}) {
  const k = keyFor(p);
  if (!k) return { ok: false, error: 'a path is required' };
  const resolved = path.resolve(String(p).trim());

  const detected = detect(resolved);
  const rows = readAll();
  const now = new Date().toISOString();
  const i = rows.findIndex((r) => r.key === k);

  if (i >= 0) {
    const prev = rows[i];
    rows[i] = {
      ...prev,
      path: resolved,
      name: name || prev.name || detected.name || path.basename(resolved),
      kind: kind || detected.kind || prev.kind,
      isGit: detected.isGit,
      signals: detected.signals,
      lastOpened: now,
      openCount: (Number(prev.openCount) || 0) + 1,
      pinned: pinned === null ? !!prev.pinned : !!pinned,
      createdByRama: prev.createdByRama || !!createdByRama,
      note: note ?? prev.note ?? null,
      missing: false,
    };
    writeAll(rows);
    return { ok: true, created: false, project: rows[i] };
  }

  const entry = {
    key: k,
    path: resolved,
    name: name || detected.name || path.basename(resolved),
    kind: kind || detected.kind,
    isGit: detected.isGit,
    signals: detected.signals,
    firstSeen: now,
    lastOpened: now,
    openCount: 1,
    pinned: !!pinned,
    createdByRama: !!createdByRama,
    note: note || null,
    missing: false,
  };
  rows.push(entry);

  // Evict the least-recently-opened UNPINNED entries only. A pinned project is master's explicit
  // statement that it matters, so the cap must never silently drop one.
  if (rows.length > MAX_ENTRIES) {
    const unpinned = rows.filter((r) => !r.pinned)
      .sort((a, b) => String(a.lastOpened || '').localeCompare(String(b.lastOpened || '')));
    const drop = new Set(unpinned.slice(0, rows.length - MAX_ENTRIES).map((r) => r.key));
    for (let j = rows.length - 1; j >= 0; j--) {
      if (drop.has(rows[j].key) && rows[j].key !== k) rows.splice(j, 1);
    }
  }

  writeAll(rows);
  return { ok: true, created: true, project: entry };
}

/** Bump recency without changing anything else — what a page calls when master opens a folder. */
function touch(p) {
  const k = keyFor(p);
  if (!k) return { ok: false, error: 'a path is required' };
  const rows = readAll();
  const i = rows.findIndex((r) => r.key === k);
  if (i < 0) return register({ path: p });
  rows[i].lastOpened = new Date().toISOString();
  rows[i].openCount = (Number(rows[i].openCount) || 0) + 1;
  writeAll(rows);
  return { ok: true, project: rows[i] };
}

function pin(p, pinned = true) {
  const k = keyFor(p);
  if (!k) return { ok: false, error: 'a path is required' };
  const rows = readAll();
  const i = rows.findIndex((r) => r.key === k);
  if (i < 0) return register({ path: p, pinned: !!pinned });
  rows[i].pinned = !!pinned;
  writeAll(rows);
  return { ok: true, project: rows[i] };
}

/** Master forgets a project. Only ever removes the record, never anything on disk. */
function forget(p) {
  const k = keyFor(p);
  if (!k) return { ok: false, error: 'a path is required' };
  const rows = readAll();
  const next = rows.filter((r) => r.key !== k);
  if (next.length === rows.length) return { ok: false, error: 'not in the registry' };
  writeAll(next);
  return { ok: true, forgotten: k, remaining: next.length };
}

/**
 * The folder a page should default to when it has no better idea.
 *
 * This is the whole point of the registry from master's side: a page opens on what he last worked
 * on rather than an empty picker. `requireGit` lets GitSync ask for the most recent *repository*
 * specifically, since a plain folder would be useless to it.
 */
function preferred({ requireGit = false } = {}) {
  const rows = list().filter((r) => !r.missing && (!requireGit || r.isGit));
  return rows[0] || null;
}

module.exports = {
  useStore, list, find, register, touch, pin, forget, preferred, detect, keyFor,
  sortRows, KINDS, MAX_ENTRIES, DOMAIN, KEY,
};
