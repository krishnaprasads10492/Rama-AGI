'use strict';

/**
 * shipLog.cjs — put a build transcript where Rāma (and master) can read it from
 * any machine, then keep the local log directory from growing forever.
 *
 * WHY: packaging happens on whichever laptop can actually build. The transcript
 * lands in `data/logs/` on that machine, and `data/` is gitignored, so a failure
 * on one device is invisible from the other. The git remote is already an
 * authenticated channel both machines use, so it is the transport (same reasoning
 * as SECTION 46's fleet bus: no listener, no inbound connection, auditable).
 *
 * TWO THINGS THIS DOES NOT DO, deliberately:
 *
 * 1. It does not touch the working tree. No checkout, no stash, no branch
 *    switch, no change to the index. It builds the commit with git plumbing
 *    (hash-object → update-index against a throwaway index → write-tree →
 *    commit-tree → update-ref) and pushes that. A build script that could leave
 *    master's working tree on another branch, mid-build, would be a bad trade
 *    for a log file. It also means `.gitignore`'s `*.log` rule is irrelevant
 *    here — plumbing does not consult it — so no `git add -f` games.
 *
 * 2. It does not ship raw. The publish repo is `"private": false` and a
 *    transcript carries the OS username, the home directory and the hostname.
 *    Those are redacted first. A feature meant to help must not quietly publish
 *    master's machine layout to a public repo.
 *
 * Usage:
 *   node scripts/shipLog.cjs                 newest transcript
 *   node scripts/shipLog.cjs --file <path>    a specific one
 *   node scripts/shipLog.cjs --dry-run        redact and report, push nothing
 *   node scripts/shipLog.cjs --no-push        commit locally, do not push
 *   node scripts/shipLog.cjs --prune-only     only clean old local logs
 *   node scripts/shipLog.cjs --keep <n>       local transcripts to retain (default 20)
 */

const { execFileSync } = require('child_process');
const fs   = require('fs');
const os   = require('os');
const path = require('path');

const ROOT     = path.join(__dirname, '..');
const LOG_DIR  = path.join(ROOT, 'data', 'logs');
const BRANCH   = 'build-logs';
const DEST_DIR = 'build-logs';

const args = process.argv.slice(2);
const has  = (f) => args.includes(f);
const valueOf = (f, fallback) => {
  const i = args.indexOf(f);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const dryRun    = has('--dry-run');
const noPush    = has('--no-push');
const pruneOnly = has('--prune-only');
const showHelp  = has('--help') || has('-h');
const keepCount = Math.max(1, Number(valueOf('--keep', 20)) || 20);

const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  cyan: '\x1b[36m', green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m',
};
const out   = (m) => process.stdout.write(`${m}\n`);
const ok    = (m) => out(`  ${C.green}✓${C.reset} ${m}`);
const warn  = (m) => out(`  ${C.yellow}!${C.reset} ${m}`);
const fail  = (m) => out(`  ${C.red}✕${C.reset} ${m}`);
const info  = (m) => out(`  ${C.cyan}·${C.reset} ${m}`);

function git(argv, opts = {}) {
  return execFileSync('git', argv, {
    cwd: ROOT, encoding: 'utf8', stdio: 'pipe', timeout: 120_000, ...opts,
  }).trim();
}
function tryGit(argv, opts = {}) {
  try { return { ok: true, out: git(argv, opts) }; }
  catch (e) {
    const stderr = e.stderr?.toString?.() ?? '';
    return { ok: false, error: (stderr || e.message || String(e)).trim() };
  }
}

// ─── Redaction ────────────────────────────────────────────────────────────────
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Strip machine-identifying detail. Ordered longest-first so the home directory
 * is replaced before the bare username inside it.
 * @returns {{text:string, hits:number}}
 */
function redact(text) {
  let hits = 0;
  const sub = (pattern, replacement) => {
    const before = text;
    text = text.replace(pattern, replacement);
    if (text !== before) hits++;
  };

  let username = '';
  let hostname = '';
  try { username = os.userInfo().username || ''; } catch { /* not critical */ }
  try { hostname = os.hostname() || ''; } catch { /* not critical */ }

  const home = os.homedir() || '';
  if (home) sub(new RegExp(escapeRe(home), 'gi'), '<HOME>');

  // Any Windows user profile path, including other machines' in pasted output.
  sub(/([A-Za-z]:\\Users\\)[^\\\r\n"']+/g, '$1<USER>');
  sub(/(\/(?:home|Users)\/)[^/\r\n"']+/g, '$1<USER>');

  if (username && username.length > 2) sub(new RegExp(escapeRe(username), 'gi'), '<USER>');
  if (hostname && hostname.length > 2) sub(new RegExp(escapeRe(hostname), 'gi'), '<HOST>');

  return { text, hits };
}

// ─── Transcript selection ─────────────────────────────────────────────────────
function transcripts() {
  let names = [];
  try { names = fs.readdirSync(LOG_DIR); } catch { return []; }
  return names
    .filter(n => /^build-.*\.log$/.test(n))
    .map(n => {
      const full = path.join(LOG_DIR, n);
      try { return { name: n, full, mtime: fs.statSync(full).mtimeMs }; }
      catch { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => b.mtime - a.mtime);
}

function newestTranscript() {
  const explicit = valueOf('--file', null);
  if (explicit) {
    const full = path.isAbsolute(explicit) ? explicit : path.join(ROOT, explicit);
    if (!fs.existsSync(full)) { fail(`No such transcript: ${explicit}`); return null; }
    return { name: path.basename(full), full };
  }
  const all = transcripts();
  if (all.length === 0) { warn(`No transcripts in ${path.relative(ROOT, LOG_DIR)}`); return null; }
  return all[0];
}

// ─── Retention ────────────────────────────────────────────────────────────────
/**
 * Keep the most recent `keepCount`, delete the rest. Called after a successful
 * ship so the shipped one is never the thing that gets removed, and the local
 * directory does not grow without bound across dozens of builds.
 */
function prune(keep = keepCount) {
  const all = transcripts();
  if (all.length <= keep) {
    info(`${all.length} transcript(s) kept locally (limit ${keep}) — nothing to prune`);
    return { removed: 0 };
  }
  let removed = 0;
  let freed   = 0;
  for (const t of all.slice(keep)) {
    try {
      freed += fs.statSync(t.full).size;
      fs.rmSync(t.full);
      removed++;
    } catch { /* in use or already gone */ }
  }
  ok(`Pruned ${removed} old transcript(s), freed ${(freed / 1024).toFixed(0)} KB (kept newest ${keep})`);
  return { removed, freed };
}

// ─── Shipping ─────────────────────────────────────────────────────────────────
/**
 * Commit `content` as `build-logs/<name>` on the `build-logs` branch using
 * plumbing only, so the working tree and index are untouched.
 */
function commitViaPlumbing(name, content) {
  const tmpIndex = path.join(os.tmpdir(), `rama-shiplog-index-${process.pid}`);
  const tmpFile  = path.join(os.tmpdir(), `rama-shiplog-${process.pid}-${name}`);
  const destPath = `${DEST_DIR}/${name}`;

  try {
    fs.writeFileSync(tmpFile, content);

    const blob = tryGit(['hash-object', '-w', '--', tmpFile]);
    if (!blob.ok) return { ok: false, error: `hash-object failed: ${blob.error}` };

    // Carry forward whatever is already on the branch so history accumulates
    // rather than each push replacing the last log.
    const parent = tryGit(['rev-parse', '--verify', `refs/heads/${BRANCH}`]);
    const hasParent = parent.ok;

    const env = { ...process.env, GIT_INDEX_FILE: tmpIndex };
    if (hasParent) {
      const read = tryGit(['read-tree', `refs/heads/${BRANCH}`], { env });
      if (!read.ok) return { ok: false, error: `read-tree failed: ${read.error}` };
    }

    const add = tryGit(
      ['update-index', '--add', '--cacheinfo', `100644,${blob.out},${destPath}`],
      { env },
    );
    if (!add.ok) return { ok: false, error: `update-index failed: ${add.error}` };

    const tree = tryGit(['write-tree'], { env });
    if (!tree.ok) return { ok: false, error: `write-tree failed: ${tree.error}` };

    const message = `chore(logs): ${name}`;
    const commitArgs = ['commit-tree', tree.out, '-m', message];
    if (hasParent) commitArgs.push('-p', parent.out);

    const commit = tryGit(commitArgs);
    if (!commit.ok) return { ok: false, error: `commit-tree failed: ${commit.error}` };

    const ref = tryGit(['update-ref', `refs/heads/${BRANCH}`, commit.out]);
    if (!ref.ok) return { ok: false, error: `update-ref failed: ${ref.error}` };

    return { ok: true, commit: commit.out, destPath };
  } finally {
    for (const f of [tmpIndex, tmpFile]) {
      try { if (fs.existsSync(f)) fs.rmSync(f); } catch { /* temp */ }
    }
  }
}

function help() {
  out(`
${C.bold}Rāma AGI — ship a build transcript${C.reset}

  npm run ship-log                       newest transcript
  node scripts/shipLog.cjs --file <p>    a specific transcript
  node scripts/shipLog.cjs --dry-run     redact and report, push nothing
  node scripts/shipLog.cjs --no-push     commit locally, do not push
  node scripts/shipLog.cjs --prune-only  only clean old local logs
  node scripts/shipLog.cjs --keep <n>    local transcripts to retain (default 20)

Pushes to the ${C.bold}${BRANCH}${C.reset} branch as ${DEST_DIR}/<name>, using git plumbing so
your working tree, index and current branch are never touched. The OS username,
home directory and hostname are redacted first, because the repo is public.
`);
}

function main() {
  if (showHelp) { help(); return 0; }

  out(`\n${C.bold}  ⬢ Rāma AGI — ship log${C.reset}`);

  if (pruneOnly) { prune(); return 0; }

  const inside = tryGit(['rev-parse', '--is-inside-work-tree']);
  if (!inside.ok) { fail('Not a git repository — nothing to ship to.'); return 1; }

  const t = newestTranscript();
  if (!t) return 1;

  let raw;
  try { raw = fs.readFileSync(t.full, 'utf8'); }
  catch (e) { fail(`Could not read ${t.name}: ${e.message}`); return 1; }

  if (raw.trim().length === 0) {
    warn(`${t.name} is empty — not shipping it`);
    return 0;
  }

  const { text, hits } = redact(raw);
  info(`${t.name} — ${(raw.length / 1024).toFixed(1)} KB, ${hits} redaction rule(s) applied`);

  if (dryRun) {
    out('');
    out(`  ${C.bold}Dry run — nothing committed or pushed.${C.reset}`);
    out(`  Would commit  ${DEST_DIR}/${t.name} on branch ${BRANCH}`);
    out(`  Redacted      ${hits} rule(s) matched (username, home path, hostname)`);
    out('');
    return 0;
  }

  const committed = commitViaPlumbing(t.name, text);
  if (!committed.ok) { fail(committed.error); return 1; }
  ok(`Committed ${committed.destPath} (${committed.commit.slice(0, 8)}) on ${BRANCH}`);

  if (noPush) {
    info(`--no-push: run "git push origin ${BRANCH}" when ready`);
    prune();
    return 0;
  }

  const pushed = tryGit(['push', 'origin', `refs/heads/${BRANCH}:refs/heads/${BRANCH}`]);
  if (!pushed.ok) {
    warn(`Commit is local — push failed: ${pushed.error.split('\n')[0]}`);
    info(`Retry with: git push origin ${BRANCH}`);
    prune();
    return 0;   // the log is preserved locally; this is not a build failure
  }
  ok(`Pushed to origin/${BRANCH}`);
  out(`  ${C.dim}Readable from any machine: git fetch origin ${BRANCH} && git show origin/${BRANCH}:${committed.destPath}${C.reset}`);

  prune();
  out('');
  return 0;
}

try {
  process.exitCode = main();
} catch (e) {
  fail(`ship-log aborted: ${e.message ?? String(e)}`);
  process.exitCode = 1;
}
