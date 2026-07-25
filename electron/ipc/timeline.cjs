'use strict';

/**
 * timeline.cjs — Timeline Flashbacks: git-backed state replay.
 *
 * Rāma modifies its own source. That is only safe if any past state can be
 * inspected and returned to. This module turns the git history of Rāma's own
 * repository into a navigable timeline:
 *
 *   - MARKERS   named points in time, correlated with what Rāma was doing
 *               (proposal applied, evolution absorbed, regen written)
 *   - FLASHBACK read any file as it existed at any commit, without touching
 *               the working tree — pure inspection, zero risk
 *   - DIFF      what changed between two points, and who caused it
 *   - RESTORE   bring a past version of a file back — routed through the
 *               proposal ledger, so a rollback is approved like any other change
 *
 * SAFETY:
 *   - Read paths (`show`, `diff`, `markers`) never mutate the repository
 *   - RESTORE never runs `git checkout`/`reset` on the working tree. It reads the
 *     old content and files a proposal. Destructive git operations are not
 *     exposed here at all.
 */

const path = require('path');

let simpleGit = null;
try {
  simpleGit = require('simple-git');
} catch {
  console.warn('[timeline] simple-git not installed — timeline flashbacks disabled');
}

// ─── Correlated markers ───────────────────────────────────────────────────────
// Commits alone say what changed; markers say why. Populated from the event bus.
const markers = [];        // newest-first
const MAX_MARKERS = 300;

function addMarker(marker) {
  markers.unshift({ ts: Date.now(), ...marker });
  if (markers.length > MAX_MARKERS) markers.pop();
}

function repoRoot(explicit) {
  // electron/ipc → repo root is two levels up
  return explicit || path.resolve(__dirname, '..', '..');
}

function git(repoPath) {
  if (!simpleGit) throw new Error('simple-git not installed');
  return simpleGit(repoRoot(repoPath));
}

// ─── Timeline construction ────────────────────────────────────────────────────
/**
 * Build the timeline: commits, enriched with any markers that fall near them.
 * @param {object} opts { repoPath, limit, file }
 */
async function buildTimeline(opts = {}) {
  const { repoPath = null, limit = 60, file = null } = opts;

  const log = await git(repoPath).log(
    file ? { file, maxCount: limit } : { maxCount: limit }
  );

  const entries = (log.all || []).map(c => ({
    hash:      c.hash,
    short:     c.hash.slice(0, 8),
    date:      c.date,
    ts:        Date.parse(c.date) || null,
    message:   c.message,
    author:    c.author_name,
    // Rāma's own commits are tagged by convention in the message
    bySelf:    /self-modify|regen|evolution|genome/i.test(c.message || ''),
    markers:   [],
  }));

  // Attach markers to the nearest commit within a 10 minute window
  for (const m of markers) {
    let best = null;
    let bestGap = Infinity;
    for (const e of entries) {
      if (!e.ts) continue;
      const gap = Math.abs(e.ts - m.ts);
      if (gap < bestGap) { bestGap = gap; best = e; }
    }
    if (best && bestGap <= 10 * 60 * 1000) best.markers.push(m);
  }

  return {
    entries,
    total:        entries.length,
    markerCount:  markers.length,
    unattached:   markers.filter(m =>
      !entries.some(e => e.markers.includes(m))).slice(0, 20),
  };
}

// ─── Flashback: read the past ─────────────────────────────────────────────────
/**
 * Read a file exactly as it was at a commit. Does not touch the working tree.
 * @returns {{ok:boolean, content?:string, error?:string}}
 */
async function flashback({ repoPath = null, hash, file }) {
  if (!hash || !file) return { ok: false, error: 'hash and file are required' };

  // Normalise to a repo-relative POSIX path — git does not accept Windows paths
  const root = repoRoot(repoPath);
  const rel  = path.isAbsolute(file)
    ? path.relative(root, file).split(path.sep).join('/')
    : file.split(path.sep).join('/');

  try {
    const content = await git(repoPath).show([`${hash}:${rel}`]);
    return { ok: true, content, file: rel, hash, bytes: Buffer.byteLength(content) };
  } catch (err) {
    return { ok: false, error: `Not found at ${hash.slice(0, 8)}: ${rel}` };
  }
}

/** What changed between two points in time. */
async function compare({ repoPath = null, from, to = 'HEAD', file = null }) {
  if (!from) return { ok: false, error: 'from is required' };
  try {
    const args = [from, to];
    if (file) args.push('--', file.split(path.sep).join('/'));
    const diff = await git(repoPath).diff(args);
    const stat = await git(repoPath).diffSummary([from, to]);
    return {
      ok: true,
      diff,
      files:      stat.files?.map(f => ({ file: f.file, changes: f.changes, insertions: f.insertions, deletions: f.deletions })) ?? [],
      insertions: stat.insertions,
      deletions:  stat.deletions,
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/** Every commit that touched a file — its change history. */
async function fileHistory({ repoPath = null, file, limit = 40 }) {
  if (!file) return { ok: false, error: 'file is required' };
  try {
    const rel = file.split(path.sep).join('/');
    const log = await git(repoPath).log({ file: rel, maxCount: limit });
    return {
      ok: true,
      file: rel,
      commits: (log.all || []).map(c => ({
        hash: c.hash, short: c.hash.slice(0, 8), date: c.date,
        message: c.message, author: c.author_name,
      })),
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ─── Restore: bring the past back, through the approval gate ───────────────────
/**
 * Propose restoring a file to a past version. Deliberately does NOT write.
 * A rollback is a change to Rāma's source like any other, so it gets the same
 * master approval and the same audit entry.
 */
async function proposeRestore({ repoPath = null, hash, file, reason = '' }) {
  const past = await flashback({ repoPath, hash, file });
  if (!past.ok) return past;

  let ledger;
  try { ledger = require('../lib/proposals.cjs'); }
  catch { return { ok: false, error: 'Proposal ledger unavailable — refusing to write directly' }; }

  const target = path.isAbsolute(file) ? file : path.join(repoRoot(repoPath), file);

  const proposal = ledger.create({
    kind:    ledger.KINDS.SELF_MODIFY,
    title:   `Restore ${past.file} to ${hash.slice(0, 8)}`,
    summary: reason || `Timeline flashback restore of ${past.file} from commit ${hash.slice(0, 8)}`,
    changes: [{ action: 'patch', path: target, content: past.content }],
    risk:    'high',
    meta:    { kind: 'timeline-restore', hash, file: past.file },
  });

  addMarker({ type: 'restore-proposed', file: past.file, hash, proposalId: proposal.id });

  return { ok: true, data: { proposalId: proposal.id, file: past.file, hash, bytes: past.bytes } };
}

// The restore applier — writes only what the ledger hands it, after approval.
try {
  const ledger = require('../lib/proposals.cjs');
  if (!ledger.hasSelfModifyApplier) {
    const fs = require('fs');
    ledger.registerApplier(ledger.KINDS.SELF_MODIFY, async (proposal) => {
      const results = [];
      for (const change of proposal.changes || []) {
        if (change.action === 'delete') {
          fs.rmSync(change.path, { force: true });
          results.push({ path: change.path, deleted: true });
          continue;
        }
        fs.mkdirSync(path.dirname(change.path), { recursive: true });
        fs.writeFileSync(change.path, change.content, 'utf8');
        results.push({ path: change.path, written: true });
      }
      addMarker({ type: 'self-modify-applied', proposalId: proposal.id, files: results.length });
      return results;
    });
    ledger.hasSelfModifyApplier = true;
  }
} catch { /* ledger unavailable at load time */ }

// ─── Event bus wiring — markers come from what Rāma actually did ───────────────
function wireBus() {
  let bus;
  try { bus = require('../ramaEventBus.cjs').bus; } catch { return; }
  if (!bus?.on) return;

  const channels = [
    ['regen:applied',       'code-regenerated'],
    ['evolution:applied',   'capability-absorbed'],
    ['proposals:applied',   'proposal-applied'],
    ['instance:spawned',    'instance-spawned'],
    ['meta:regression',     'regression-detected'],
  ];

  for (const [channel, type] of channels) {
    try { bus.on(channel, (payload) => addMarker({ type, payload: summarisePayload(payload) })); }
    catch { /* channel not present */ }
  }
}

function summarisePayload(p) {
  if (!p || typeof p !== 'object') return {};
  const { id, kind, filePath, role, findings } = p;
  return {
    ...(id ? { id } : {}),
    ...(kind ? { kind } : {}),
    ...(filePath ? { filePath } : {}),
    ...(role ? { role } : {}),
    ...(Array.isArray(findings) ? { findings: findings.length } : {}),
  };
}

// ─── IPC ──────────────────────────────────────────────────────────────────────
function register(ipcMain) {
  wireBus();

  ipcMain.handle('timeline:get', async (_e, opts) => {
    if (!simpleGit) return { ok: false, error: 'simple-git not installed' };
    try { return { ok: true, data: await buildTimeline(opts || {}) }; }
    catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle('timeline:flashback',    async (_e, opts) => flashback(opts || {}));
  ipcMain.handle('timeline:compare',      async (_e, opts) => compare(opts || {}));
  ipcMain.handle('timeline:file-history', async (_e, opts) => fileHistory(opts || {}));
  ipcMain.handle('timeline:propose-restore', async (_e, opts) => proposeRestore(opts || {}));

  ipcMain.handle('timeline:markers', async (_e, limit) => ({
    ok: true, data: markers.slice(0, limit || 100),
  }));

  ipcMain.handle('timeline:mark', async (_e, marker) => {
    addMarker(marker || { type: 'manual' });
    return { ok: true };
  });
}

module.exports = {
  register, addMarker,
  buildTimeline, flashback, compare, fileHistory, proposeRestore,
  markers,
};
