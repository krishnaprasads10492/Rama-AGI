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
// Crash reports from the installed app travel by default — they are the reason
// this script is usually run. These narrow it when only one kind is wanted.
const crashesOnly     = has('--crashes-only');
const transcriptsOnly = has('--transcripts-only');
const crashKeep       = Math.max(1, Number(valueOf('--crash-count', 10)) || 10);

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

  // BOTH forms of every path rule below, because two kinds of file travel through
  // here. A build transcript is plain text with single separators; a crash report
  // is JSON, where every separator arrives doubled (`C:\\Users\\name`). The first
  // version of this only matched single backslashes, so it reported "0 redaction
  // rules applied" on a crash report and shipped the username to a public repo
  // intact. Caught by reading the committed blob back rather than trusting the hit
  // count — which is exactly why that check exists.
  const home = os.homedir() || '';
  if (home) {
    sub(new RegExp(escapeRe(home.replace(/\\/g, '\\\\')), 'gi'), '<HOME>');   // JSON-escaped
    sub(new RegExp(escapeRe(home), 'gi'), '<HOME>');                          // plain
  }

  // Any Windows user profile path, including other machines' in pasted output.
  sub(/([A-Za-z]:\\\\Users\\\\)[^\\\r\n"']+/g, '$1<USER>');   // JSON:  C:\\Users\\name
  sub(/([A-Za-z]:\\Users\\)[^\\\r\n"']+/g, '$1<USER>');       // plain: C:\Users\name
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

// ─── Crash reports from the installed app ─────────────────────────────────────
/**
 * Find the crash directory `crashGuard` writes to.
 *
 * WHY THIS SEARCHES RATHER THAN COMPUTES: the path is
 * `app.getPath('userData')/crash`, and `app.getName()` resolves differently
 * depending on whether a top-level `productName` exists in the packaged
 * package.json — so it could be `%APPDATA%\rama-agi` or `%APPDATA%\Rama AGI`.
 * Guessing one and reporting "no crashes found" when the folder is simply
 * somewhere else would be a lie of omission at the worst moment. `crashGuard` also
 * falls back to `~/.rama-agi` when the app is unavailable, so that is checked too.
 *
 * The repo lives on the same machine as the install — that is how the build was
 * produced — so the checkout can read the installed app's crash folder directly.
 */
function crashDirs() {
  const explicit = valueOf('--crash-dir', null);
  if (explicit) return [explicit];

  const out = [];
  const push = (p) => { if (p && !out.includes(p)) out.push(p); };

  const appData = process.env.APPDATA;
  const home    = os.homedir();

  // Every plausible spelling of the app's userData directory.
  for (const appName of ['rama-agi', 'Rama AGI', 'Rāma AGI', 'RamaAGI']) {
    if (appData) push(path.join(appData, appName, 'crash'));
    if (home)    push(path.join(home, 'AppData', 'Roaming', appName, 'crash'));
  }
  // crashGuard's own fallback when app.getPath is unavailable.
  if (home) push(path.join(home, '.rama-agi', 'crash'));

  return out.filter(d => { try { return fs.existsSync(d); } catch { return false; } });
}

/** Crash reports, newest first, across every crash directory that exists. */
function crashReports() {
  const found = [];
  for (const dir of crashDirs()) {
    let names = [];
    try { names = fs.readdirSync(dir); } catch { continue; }
    for (const n of names) {
      if (!/^crash-.*\.json$/.test(n)) continue;
      const full = path.join(dir, n);
      try { found.push({ name: n, full, dir, mtime: fs.statSync(full).mtimeMs }); }
      catch { /* vanished between readdir and stat */ }
    }
  }
  return found.sort((a, b) => b.mtime - a.mtime);
}

/**
 * One-line summary of a crash report, printed before shipping so master sees the
 * cause immediately rather than having to wait for the round trip.
 */
function summariseCrash(full) {
  try {
    const r = JSON.parse(fs.readFileSync(full, 'utf8'));
    const what = r.missingModule
      ? `missing module "${r.missingModule}"`
      : (r.message ?? 'unknown error');
    const wanted = Array.isArray(r.requireStack) && r.requireStack[0]
      ? `, wanted by ${path.basename(r.requireStack[0])}`
      : '';
    return `${String(r.ts ?? '').slice(0, 19)} — ${what}${wanted}`;
  } catch {
    return 'unreadable report';
  }
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
/**
 * @param {Array<{destPath:string, content:string}>} entries
 * @param {string} message commit subject
 */
function commitViaPlumbing(entries, message) {
  if (!entries.length) return { ok: false, error: 'nothing to commit' };

  const tmpIndex = path.join(os.tmpdir(), `rama-shiplog-index-${process.pid}`);
  const tmpFiles = [];

  try {
    // Carry forward whatever is already on the branch so history accumulates
    // rather than each push replacing the last log.
    const parent = tryGit(['rev-parse', '--verify', `refs/heads/${BRANCH}`]);
    const hasParent = parent.ok;

    const env = { ...process.env, GIT_INDEX_FILE: tmpIndex };
    if (hasParent) {
      const read = tryGit(['read-tree', `refs/heads/${BRANCH}`], { env });
      if (!read.ok) return { ok: false, error: `read-tree failed: ${read.error}` };
    }

    for (const [i, entry] of entries.entries()) {
      const tmpFile = path.join(os.tmpdir(), `rama-shiplog-${process.pid}-${i}`);
      tmpFiles.push(tmpFile);
      fs.writeFileSync(tmpFile, entry.content);

      const blob = tryGit(['hash-object', '-w', '--', tmpFile]);
      if (!blob.ok) return { ok: false, error: `hash-object failed: ${blob.error}` };

      const add = tryGit(
        ['update-index', '--add', '--cacheinfo', `100644,${blob.out},${entry.destPath}`],
        { env },
      );
      if (!add.ok) return { ok: false, error: `update-index failed: ${add.error}` };
    }

    const tree = tryGit(['write-tree'], { env });
    if (!tree.ok) return { ok: false, error: `write-tree failed: ${tree.error}` };

    const commitArgs = ['commit-tree', tree.out, '-m', message];
    if (hasParent) commitArgs.push('-p', parent.out);

    const commit = tryGit(commitArgs);
    if (!commit.ok) return { ok: false, error: `commit-tree failed: ${commit.error}` };

    const ref = tryGit(['update-ref', `refs/heads/${BRANCH}`, commit.out]);
    if (!ref.ok) return { ok: false, error: `update-ref failed: ${ref.error}` };

    return { ok: true, commit: commit.out, count: entries.length };
  } finally {
    for (const f of [tmpIndex, ...tmpFiles]) {
      try { if (fs.existsSync(f)) fs.rmSync(f); } catch { /* temp */ }
    }
  }
}

function help() {
  out(`
${C.bold}Rāma AGI — ship a build transcript${C.reset}

  npm run ship-log                          crash reports + newest transcript
  node scripts/shipLog.cjs --crashes-only    only the installed app's crashes
  node scripts/shipLog.cjs --transcripts-only  only build transcripts
  node scripts/shipLog.cjs --crash-dir <p>  read crashes from a specific folder
  node scripts/shipLog.cjs --file <p>       a specific transcript
  node scripts/shipLog.cjs --dry-run        redact and report, push nothing
  node scripts/shipLog.cjs --no-push        commit locally, do not push
  node scripts/shipLog.cjs --prune-only     only clean old local logs
  node scripts/shipLog.cjs --keep <n>       local transcripts to retain (default 20)
  node scripts/shipLog.cjs --crash-count <n>  crash reports to ship (default 10)

Pushes to the ${C.bold}${BRANCH}${C.reset} branch — transcripts under ${DEST_DIR}/, crash
reports under crash-reports/ — using git plumbing, so your working tree, index and
current branch are never touched.

Crash reports are read from the INSTALLED app's data directory, which is on this
same machine. Several spellings of that path are searched, because it depends on
how the app resolves its own name. The OS username, home directory and hostname are
redacted from everything before it is committed, because the repo is public.
`);
}

function main() {
  if (showHelp) { help(); return 0; }

  out(`\n${C.bold}  ⬢ Rāma AGI — ship log${C.reset}`);

  if (pruneOnly) { prune(); return 0; }

  const inside = tryGit(['rev-parse', '--is-inside-work-tree']);
  if (!inside.ok) { fail('Not a git repository — nothing to ship to.'); return 1; }

  const entries = [];

  // ── Crash reports from the installed app ────────────────────────────────────
  // Shipped first and unconditionally, because a crash is the most valuable thing
  // this script can carry: it is the difference between "it crashed" and knowing
  // which module was missing and which part of Rāma wanted it.
  if (!transcriptsOnly) {
    const crashes = crashReports();
    if (crashes.length === 0) {
      const searched = crashDirs();
      info(searched.length
        ? `No crash reports in ${searched.join(', ')}`
        : 'No crash directory found — the installed app has not crashed, or uses a path not searched');
    } else {
      info(`${crashes.length} crash report(s) found:`);
      for (const c of crashes.slice(0, crashKeep)) {
        out(`      ${C.yellow}${summariseCrash(c.full)}${C.reset}`);
        let raw;
        try { raw = fs.readFileSync(c.full, 'utf8'); } catch { continue; }
        const { text } = redact(raw);
        entries.push({ destPath: `crash-reports/${c.name}`, content: text });
      }
    }
  }

  // ── Build transcript ────────────────────────────────────────────────────────
  if (!crashesOnly) {
    const t = newestTranscript();
    if (t) {
      let raw = null;
      try { raw = fs.readFileSync(t.full, 'utf8'); }
      catch (e) { warn(`Could not read ${t.name}: ${e.message}`); }

      if (raw && raw.trim().length > 0) {
        const { text, hits } = redact(raw);
        info(`${t.name} — ${(raw.length / 1024).toFixed(1)} KB, ${hits} redaction rule(s) applied`);
        entries.push({ destPath: `${DEST_DIR}/${t.name}`, content: text });
      } else if (raw !== null) {
        warn(`${t.name} is empty — not shipping it`);
      }
    }
  }

  if (entries.length === 0) {
    warn('Nothing to ship.');
    return 0;
  }

  if (dryRun) {
    out('');
    out(`  ${C.bold}Dry run — nothing committed or pushed.${C.reset}`);
    for (const e of entries) out(`  Would commit  ${e.destPath}`);
    out(`  On branch     ${BRANCH}`);
    out(`  ${C.dim}Machine paths, username and hostname are redacted first.${C.reset}`);
    out('');
    return 0;
  }

  const subject = entries.some(e => e.destPath.startsWith('crash-reports/'))
    ? `chore(diagnostics): ${entries.length} report(s) from an installed build`
    : `chore(logs): ${entries.length} build transcript(s)`;

  const committed = commitViaPlumbing(entries, subject);
  if (!committed.ok) { fail(committed.error); return 1; }
  ok(`Committed ${committed.count} file(s) (${committed.commit.slice(0, 8)}) on ${BRANCH}`);

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
  out(`  ${C.dim}Readable from any machine:${C.reset}`);
  out(`  ${C.dim}  git fetch origin ${BRANCH} && git ls-tree -r --name-only origin/${BRANCH}${C.reset}`);

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
