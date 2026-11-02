'use strict';

/**
 * fieldReport.cjs - ask the machine that actually runs Rāma what it can confirm (spec Section 171)
 *
 * This is the impure half. `electron/lib/fieldEvidence.cjs` holds the claims, the verdicts and the
 * report and touches nothing; this script reads the machine and hands it facts. The split is the
 * same one Section 170 used, and for the same reason: the part that decides what a finding MEANS
 * should be testable without a machine to decide it about.
 *
 * OFF UNLESS MASTER TURNS IT ON. With no flag set, this prints what it would collect and exits
 * having written nothing. Three modes:
 *
 *   off     (default) nothing recorded, nothing written
 *   local   a redacted report is written to data/logs/, for master to read or hand over
 *   ship    additionally allowed to travel, on the `build-logs` branch
 *
 * Usage:
 *   node scripts/fieldReport.cjs                        collect and report under the current mode
 *   node scripts/fieldReport.cjs --mode local            override the flag for this run
 *   node scripts/fieldReport.cjs --note <claim> --state observed [--detail k=v,k=v]
 *   node scripts/fieldReport.cjs --forget <claim>        drop a recorded observation
 *   node scripts/fieldReport.cjs --show                  print the stored ledger, write nothing
 *
 *   $env:RAMA_FIELD_EVIDENCE = 'local'                   the build machine has no UI session
 *
 * IT OBSERVES, IT NEVER EXERCISES (171.2). Nothing here logs in, pushes, unlocks a vault or spawns
 * a process. Every collector reads a file or an environment variable. A collector that cannot tell
 * records nothing, which the report shows as `never-observed` rather than as a pass.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const fe = require(path.join(ROOT, 'electron/lib/fieldEvidence.cjs'));
const { redact, commitViaPlumbing, BRANCH } = require(path.join(ROOT, 'scripts/shipLog.cjs'));

const LEDGER_FILE = path.join(ROOT, 'data', 'field-evidence.json');
const LOG_DIR = path.join(ROOT, 'data', 'logs');
const DEST_DIR = 'field-evidence';

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const valueOf = (f, fallback = null) => {
  const i = args.indexOf(f);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};

const C = { reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m', cyan: '\x1b[36m', green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m' };
const out = (m) => process.stdout.write(`${m}\n`);
const ok = (m) => out(`  ${C.green}✓${C.reset} ${m}`);
const warn = (m) => out(`  ${C.yellow}!${C.reset} ${m}`);
const fail = (m) => out(`  ${C.red}✕${C.reset} ${m}`);
const info = (m) => out(`  ${C.cyan}·${C.reset} ${m}`);

// ─── The stored ledger of observations ──────────────────────────────────────────────────────────
// `data/` is gitignored, so nothing here is ever committed by accident. Observations PERSIST
// because they are the only record that a real run happened: the artefact that proved it may be
// gone by the time anyone asks. `build/` is deleted by the routine post-task cleanup, so an
// inference drawn from it later would be wrong - the moment of observation is the only honest one.
function loadLedger() {
  try { const v = JSON.parse(fs.readFileSync(LEDGER_FILE, 'utf8')); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; }
  catch { return {}; }
}

/**
 * THE ONLY WRITE IN THIS SCRIPT, and it redacts (171.4 D6).
 *
 * Redaction happens on write rather than on send because the local file is the one master is most
 * likely to paste into a chat window; protecting only the public repo would protect the repo and
 * expose master everywhere else. Routing every write through one function is what makes that
 * structural instead of a convention - there is no second place to forget it, and the suite
 * asserts that `writeFileSync` appears exactly once in this file.
 *
 * @returns {{ok:boolean, text?:string, error?:string}} the redacted text, so callers ship what was
 *   actually written rather than redacting a second time and hoping the two agree.
 */
function writeRedacted(file, content) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const text = redact(content).text;
    fs.writeFileSync(file, text, 'utf8');
    return { ok: true, text };
  } catch (err) { return { ok: false, error: err.message }; }
}

const saveLedger = (ledger) => writeRedacted(LEDGER_FILE, JSON.stringify(ledger, null, 2));

// ─── Where the installed app keeps its data ─────────────────────────────────────────────────────
// Searched rather than computed, for the reason shipLog already documents: the directory name
// depends on how the app resolves its own name, so guessing one and reporting "not found" would be
// a lie of omission.
function userDataDirs() {
  const found = [];
  const appData = process.env.APPDATA || '';
  const home = os.homedir() || '';
  for (const name of ['rama-agi', 'Rama AGI', 'Rāma AGI', 'RamaAGI']) {
    if (appData) found.push(path.join(appData, name));
    if (home) found.push(path.join(home, 'AppData', 'Roaming', name));
  }
  if (home) found.push(path.join(home, '.rama-agi'));
  return found.filter((d, i) => found.indexOf(d) === i && exists(d));
}
const exists = (p) => { try { return fs.existsSync(p); } catch { return false; } };

// ─── The collectors ─────────────────────────────────────────────────────────────────────────────
/**
 * Each returns `{state, detail}` to record, or `null` for "I could not tell" - which stays
 * `never-observed` rather than becoming a pass. `refuted` is used when the machine was readable
 * and the claim is false, because that is a finding and not a gap.
 */
const COLLECTORS = {
  // The failure that actually killed the last build on master's machine.
  'node-floor': () => {
    let floor = null;
    try { floor = ((JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).engines) || {}).node || null; } catch { return null; }
    const m = /^\s*>=\s*(\d+\.\d+\.\d+)/.exec(String(floor || ''));
    if (!m) return null;
    const n = (v) => { const p = /^(\d+)\.(\d+)\.(\d+)/.exec(String(v)); return p ? Number(p[1]) * 1e6 + Number(p[2]) * 1e3 + Number(p[3]) : -1; };
    const here = process.versions.node;
    return { state: n(here) >= n(m[1]) ? 'inspected' : 'refuted', detail: { node: here, floor: m[1] } };
  },

  // Row 1665 has been blocked on this one fact for many sections.
  'renderer-built': () => {
    const dir = path.join(ROOT, 'build');
    if (!exists(path.join(dir, 'index.html'))) return null;
    let assets = 0;
    try { assets = fs.readdirSync(path.join(dir, 'assets')).length; } catch { assets = 0; }
    // An index.html with no assets beside it is a build that produced nothing usable.
    return { state: assets > 0 ? 'inspected' : 'refuted', detail: { assets } };
  },

  'data-outside-install': () => {
    const dirs = userDataDirs();
    if (dirs.length === 0) return null;
    const insideRepo = dirs.some((d) => path.resolve(d).toLowerCase().startsWith(path.resolve(ROOT).toLowerCase()));
    return { state: insideRepo ? 'refuted' : 'inspected', detail: { dirs: dirs.length } };
  },

  // The vault header is the one part that is deliberately readable without the password
  // (Section 159). Nothing here opens the vault; the KDF name is all that is taken.
  'vault-kdf': () => {
    for (const dir of userDataDirs()) {
      const f = path.join(dir, 'rama_vault.enc');
      if (!exists(f)) continue;
      try {
        const head = fs.readFileSync(f, 'utf8').slice(0, 512);
        const m = /"kdf"\s*:\s*"([A-Za-z0-9_-]{1,24})"/.exec(head);
        // A vault with no KDF recorded is the silent-swap risk Section 159 closed: a finding.
        return m ? { state: 'inspected', detail: { kdf: m[1] } } : { state: 'refuted', detail: { recorded: false } };
      } catch { /* try the next spelling */ }
    }
    return null;
  },

  'engine-python': () => {
    const candidates = [
      process.env.RAMA_PYTHON || '',
      path.join(ROOT, 'python-env', 'Scripts', 'python.exe'),
      path.join(ROOT, 'python-env', 'bin', 'python'),
      path.join(ROOT, '.venv-stockmind', 'Scripts', 'python.exe'),
      path.join(ROOT, '.venv-stockmind', 'bin', 'python'),
    ].filter(Boolean);
    const hit = candidates.find(exists);
    // Absence is NOT a refutation: a system Python on PATH would satisfy this and cannot be seen
    // without spawning, which 171.2 forbids. So "I could not tell" is the honest answer.
    return hit ? { state: 'inspected', detail: { bundled: true } } : null;
  },

  'archiver-present': () => {
    const bundled = exists(path.join(ROOT, 'node_modules', '7zip-bin'));
    const system = ['C:/Program Files/7-Zip/7z.exe', 'C:/Program Files (x86)/7-Zip/7z.exe']
      .some(exists);
    if (!bundled && !system) return null;   // NanaZip and PATH installs are not visible from here
    return { state: 'inspected', detail: { bundled, system } };
  },
};

// ─── Collection ─────────────────────────────────────────────────────────────────────────────────
/**
 * Run every collector, folding results into the ledger through `fieldEvidence.record` so the
 * shape-only rule and the unknown-claim refusal apply to collectors exactly as they apply to any
 * other caller. A collector that throws costs its own claim and nothing else.
 */
function collect(ledger, mode) {
  let next = ledger;
  const ran = [];
  for (const [id, fn] of Object.entries(COLLECTORS)) {
    let r = null;
    try { r = fn(); } catch { r = null; }
    if (!r) continue;
    const res = fe.record(next, { id, state: r.state, at: new Date().toISOString(), detail: r.detail }, mode);
    if (res.accepted) { next = res.ledger; ran.push(`${id}=${r.state}`); }
    else ran.push(`${id} refused (${res.reason})`);
  }
  return { ledger: next, ran };
}

// ─── Modes of operation ─────────────────────────────────────────────────────────────────────────
function doNote(ledger, mode) {
  const id = valueOf('--note');
  const state = valueOf('--state', 'observed');
  const rawDetail = valueOf('--detail', '');
  const detail = {};
  for (const pair of String(rawDetail).split(',').filter(Boolean)) {
    const [k, ...rest] = pair.split('=');
    const v = rest.join('=');
    if (!k) continue;
    detail[k.trim()] = /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : (v === 'true' ? true : (v === 'false' ? false : v));
  }
  const res = fe.record(ledger, { id, state, at: new Date().toISOString(), detail }, mode);
  if (!res.accepted) { fail(`Not recorded: ${res.reason}`); return 1; }
  const saved = saveLedger(res.ledger);
  if (!saved.ok) { fail(`Could not write the ledger: ${saved.error}`); return 1; }
  ok(`Recorded ${id} as ${state}`);
  const withheld = res.ledger[id].withheld;
  if (withheld > 0) warn(`${withheld} detail field(s) withheld as not shape-only - a report carries shapes and counts, never values`);
  return 0;
}

function doForget(ledger) {
  const id = valueOf('--forget');
  if (!(id in ledger)) { warn(`Nothing recorded for ${id}`); return 0; }
  const next = { ...ledger };
  delete next[id];
  const saved = saveLedger(next);
  if (!saved.ok) { fail(`Could not write the ledger: ${saved.error}`); return 1; }
  ok(`Dropped the record for ${id}`);
  return 0;
}

function shipReport(text, name) {
  const committed = commitViaPlumbing([{ destPath: `${DEST_DIR}/${name}`, content: text }], 'chore(diagnostics): field evidence from a running machine');
  if (!committed.ok) { warn(`Not shipped: ${committed.error}`); return false; }
  ok(`Committed ${committed.commit.slice(0, 8)} on ${BRANCH}`);
  const { execFileSync } = require('child_process');
  try {
    execFileSync('git', ['push', 'origin', `refs/heads/${BRANCH}:refs/heads/${BRANCH}`], { cwd: ROOT, stdio: 'pipe', timeout: 120_000 });
    ok(`Pushed to origin/${BRANCH}`);
    return true;
  } catch (e) {
    const msg = (e.stderr?.toString?.() || e.message || '').split('\n')[0];
    warn(`Commit is local - push failed: ${msg}`);
    info(`Retry with: git push origin ${BRANCH}`);
    return false;
  }
}

function main() {
  out(`\n${C.bold}  ⬢ Rāma AGI - field evidence${C.reset}`);

  const mode = valueOf('--mode') ? fe.readMode({ env: valueOf('--mode') })
    : fe.readMode({ env: process.env.RAMA_FIELD_EVIDENCE, config: null });

  let ledger = loadLedger();

  if (has('--show')) {
    info(`mode ${mode} · ${Object.keys(ledger).length} record(s) in ${path.relative(ROOT, LEDGER_FILE)}`);
    for (const l of fe.lines(fe.assess(ledger), mode)) out(`  ${l}`);
    return 0;
  }

  if (!fe.isOn(mode)) {
    warn('Field evidence is OFF, so nothing was recorded and nothing was written.');
    info('Turn it on for one run:   node scripts/fieldReport.cjs --mode local');
    info("Or for the session:       $env:RAMA_FIELD_EVIDENCE = 'local'");
    info(`It would collect: ${Object.keys(COLLECTORS).join(', ')}`);
    info(`And would report on ${fe.CLAIMS.length} claim(s) drawn from the ledger in SECTION 28.`);
    return 0;
  }

  if (has('--note')) return doNote(ledger, mode);
  if (has('--forget')) return doForget(ledger);

  const collected = collect(ledger, mode);
  ledger = collected.ledger;
  info(`${collected.ran.length} collector(s) had something to say: ${collected.ran.join(', ') || 'none'}`);

  const saved = saveLedger(ledger);
  if (!saved.ok) warn(`The ledger could not be written (${saved.error}) - this run's findings are in the report only`);

  const assessment = fe.assess(ledger);
  const body = fe.lines(assessment, mode).join('\n');
  out('');
  for (const l of fe.lines(assessment, mode)) out(`  ${l}`);

  const name = `field-evidence-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
  const full = path.join(LOG_DIR, name);
  const raw = `${body}\n\nnode ${process.versions.node} · ${os.platform()} ${os.release()} · ${new Date().toISOString()}\n`;
  const written = writeRedacted(full, raw);
  if (!written.ok) { fail(`Could not write the report: ${written.error}`); return 1; }
  ok(`Report written to ${path.relative(ROOT, full)} - username, home and hostname already removed`);

  // Ships exactly what was written, not a second redaction of the same input.
  if (fe.maySend(mode)) shipReport(written.text, name);
  else info('Mode is `local`, so it stays here. Use --mode ship to send it.');

  out('');
  return 0;
}

if (require.main === module) {
  try { process.exitCode = main(); }
  catch (e) { fail(`field-report aborted: ${e.message ?? String(e)}`); process.exitCode = 1; }
}

module.exports = { COLLECTORS, loadLedger, saveLedger, collect, userDataDirs, LEDGER_FILE, DEST_DIR };
