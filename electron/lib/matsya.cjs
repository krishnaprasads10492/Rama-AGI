'use strict';

/**
 * matsya.cjs — the first avatar: what may leave this machine, and proof it came back whole
 * (spec Section 192)
 *
 * THE GAP THIS CLOSES. Section 169 mapped the ten avatars onto real subsystems and found Matsya
 * MISSING: there is no copy of master's record anywhere but one machine, and three other functions
 * depend on one existing — Varaha (restore), Kalki (reset to known-good), and replication itself.
 * Measured before writing a line: zero modules under `electron/` match backup, snapshot, replicate
 * or restore. It is the only capability in this project that is genuinely absent rather than built
 * and unreachable, which is why it is the first tranche of the upgrade programme.
 *
 * WHAT MAKES IT DIFFERENT FROM A FILE COPY, and why the judgement is a pure module.
 *
 * A backup is an EGRESS. It takes the most sensitive data in the system and writes it somewhere
 * less protected, which means the dangerous decision is not "how do I copy" but "what is allowed
 * to leave, and in what form". That decision is made here, with no filesystem and no crypto of its
 * own, so `scripts/verifyMatsya.cjs` can drive it with awkward trees and assert what it refuses.
 *
 * THREE CLASSES, and the middle one is the whole point:
 *   - `ciphertext`  already encrypted at rest by `cryptoCore`/the vault. Copy as-is.
 *   - `encrypt`     readable on disk today. It may leave ONLY re-encrypted. Logs and readiness
 *                   reports are this: they are not secrets by design, but they name paths,
 *                   versions, package lists and failure text, and an attacker reading a backup
 *                   should not get a free map of the installation.
 *   - `never`       must not leave at all, in any form. `.env`, anything token-shaped, and crash
 *                   dumps — a dump is a memory image and can contain a passphrase that was in RAM.
 *                   Encrypting it would still put it somewhere a key might later be compromised.
 *
 * A FILE THIS MODULE CANNOT CLASSIFY IS `never`. Not `encrypt`, not "probably fine" — the default
 * for an unrecognised path is refusal, because the cost of being wrong is asymmetric: a file
 * wrongly excluded is a gap in a backup, and a file wrongly included is a leak that cannot be
 * recalled. Section 170 D4's rule, applied to egress.
 *
 * IT DOES NOT DECIDE WHERE THE COPY GOES. A destination is master's choice and a separate tranche;
 * this module says what may be sent and proves what came back.
 */

const path = require('path');

/** The classes, in order of how much they permit. */
const CLASSES = Object.freeze(['ciphertext', 'encrypt', 'never']);

/**
 * Path rules, most specific first, and the first match wins.
 *
 * DECLARED DATA, iterated over (the OCP form this codebase uses per 184.4): a new file kind is a
 * new row, and `verifyMatsya.cjs` walks this table rather than a list of cases.
 */
const RULES = Object.freeze([
  // ── never, and these are checked before anything else can claim them ──
  { test: /(^|[/\\])\.env(\.|$)/i, cls: 'never',
    why: 'environment files hold credentials in plaintext and are excluded from the repository for the same reason' },
  { test: /(^|[/\\])(crash|dump)[^/\\]*\.(dmp|mdmp|dump)$/i, cls: 'never',
    why: 'a crash dump is a memory image and can contain a passphrase that was in RAM when it was taken' },
  { test: /(^|[/\\])(id_rsa|id_ed25519|.*\.pem|.*\.pfx|.*\.p12|.*\.key)$/i, cls: 'never',
    why: 'a private key must never be copied anywhere, encrypted or not' },
  { test: /token|secret|credential|passwd|password/i, cls: 'never',
    why: 'the name says it holds a credential; a backup is the wrong place to find out it does not' },

  // ── ciphertext: already encrypted at rest, so copying is not an egress of plaintext ──
  { test: /(^|[/\\])rama_vault\.enc$/i, cls: 'ciphertext',
    why: 'the credential vault, AES-256-GCM with its own key derivation' },
  { test: /(^|[/\\])data[/\\]system[/\\].*\.enc$/i, cls: 'ciphertext',
    why: 'the encrypted store written by cryptoCore' },
  { test: /\.enc$/i, cls: 'ciphertext', why: 'encrypted at rest by this project\u2019s own store' },

  // ── encrypt: useful to keep, readable today, so it leaves re-encrypted or not at all ──
  { test: /(^|[/\\])data[/\\]instances[/\\]/i, cls: 'encrypt',
    why: 'instance records describe which machines run Rāma and when they last spoke' },
  { test: /(^|[/\\])data[/\\]knowledge[/\\]/i, cls: 'encrypt',
    why: 'the knowledge base is master\u2019s own material and the point of having a backup' },
  { test: /(^|[/\\])data[/\\]logs[/\\]/i, cls: 'encrypt',
    why: 'logs name paths, versions and failure text — a free map of the installation' },
  { test: /(^|[/\\])data[/\\]system[/\\].*\.json$/i, cls: 'encrypt',
    why: 'readiness and system state: not secret by design, still an inventory' },
  { test: /(^|[/\\])shared[/\\](capabilities|loyalty-tripwire)\.json$/i, cls: 'encrypt',
    why: 'the capability matrix and the tripwire baseline — what Rāma may do and what master approved' },

  // EVERYTHING ELSE UNDER `data/`, and this rule was added because running the classifier over the
  // real tree refused `data/field-evidence.json` for want of a rule — which is master's own record,
  // exactly what a backup is for. `data/` is the data directory by definition, so the default
  // inside it is "keep, encrypted"; the `never` rules above are checked first and still win, so a
  // token or a dump dropped in there is still refused. Outside `data/` the strict default stands:
  // `shared/` and the source tree are in git and are not master's record.
  { test: /(^|[/\\])data[/\\]/i, cls: 'encrypt',
    why: 'everything under data/ is master\u2019s own record, and the refusal rules above take '
      + 'precedence over this one' },
]);

/**
 * How one path may leave, with the reason.
 *
 * @returns {{path:string, cls:'ciphertext'|'encrypt'|'never', why:string, matched:boolean}}
 */
function classify(filePath) {
  const p = String(filePath || '');
  if (!p) {
    return { path: p, cls: 'never', why: 'an empty path cannot be classified, so it is refused', matched: false };
  }
  for (const rule of RULES) {
    if (rule.test.test(p)) return { path: p, cls: rule.cls, why: rule.why, matched: true };
  }
  // THE DEFAULT IS REFUSAL. An unrecognised file is not assumed harmless: a file wrongly excluded
  // is a gap, a file wrongly included is a leak that cannot be recalled.
  return {
    path: p,
    cls: 'never',
    why: 'no rule covers this path, and an unclassified file is refused rather than guessed at — '
      + 'add a rule to RULES if it genuinely belongs in a backup',
    matched: false,
  };
}

/**
 * What a snapshot of this tree would contain, and what it would refuse.
 *
 * Takes the file list from the caller rather than walking the disk, so the judgement is testable
 * against trees that do not exist (DIP, per 184.4).
 *
 * @param {string[]} files  repository-relative paths
 */
function plan(files = []) {
  const decided = (Array.isArray(files) ? files : [])
    .filter((f) => typeof f === 'string' && f.length > 0)
    .map(classify);
  const by = (c) => decided.filter((d) => d.cls === c);
  return {
    copy: by('ciphertext'),
    encrypt: by('encrypt'),
    refuse: by('never'),
    // Counts a reader can check against the file list they passed in.
    totals: {
      considered: decided.length,
      ciphertext: by('ciphertext').length,
      encrypt: by('encrypt').length,
      never: by('never').length,
      unmatched: decided.filter((d) => !d.matched).length,
    },
    // NO `ok` FIELD. A plan is not a verdict, and a caller wanting one would have to look at what
    // it refused and decide for itself whether that is acceptable.
  };
}

/**
 * The manifest: what was written, how big, and its digest.
 *
 * `digest` is supplied by the caller — this module computes nothing, so it stays pure and the
 * hashing stays in one place (`cryptoCore`). The manifest is what makes a restore CHECKABLE rather
 * than hopeful: Section 169 named Varaha and Kalki as dependent on this, and neither can trust a
 * copy it cannot verify.
 */
function manifest(entries = [], { at = null, version = 1 } = {}) {
  const rows = (Array.isArray(entries) ? entries : [])
    .filter((e) => e && typeof e.path === 'string' && typeof e.digest === 'string')
    .map((e) => ({
      path: e.path,
      cls: CLASSES.includes(e.cls) ? e.cls : 'never',
      bytes: Number.isFinite(e.bytes) ? e.bytes : null,
      digest: e.digest,
      encrypted: e.cls === 'encrypt' || e.cls === 'ciphertext',
    }));
  return {
    version,
    at: at || null,
    count: rows.length,
    // Sorted so two manifests of the same content compare equal regardless of walk order.
    entries: rows.sort((a, b) => a.path.localeCompare(b.path)),
  };
}

/**
 * Does what came back match what was written?
 *
 * THREE OUTCOMES, NOT TWO. A restore that is missing a file and a restore whose file has CHANGED
 * are different events: the first is incomplete, the second means something rewrote it, and
 * collapsing them loses the only signal that would say so.
 */
function verify(expected, actual) {
  const want = (expected && Array.isArray(expected.entries)) ? expected.entries : null;
  if (!want) {
    return { ok: false, reason: 'no manifest was supplied, so nothing can be verified either way',
      missing: [], altered: [], extra: [], matched: 0 };
  }
  const have = new Map();
  for (const a of (Array.isArray(actual) ? actual : [])) {
    if (a && typeof a.path === 'string') have.set(a.path, a);
  }
  const missing = [];
  const altered = [];
  let matched = 0;
  for (const w of want) {
    const a = have.get(w.path);
    if (!a) { missing.push(w.path); continue; }
    if (a.digest !== w.digest) { altered.push({ path: w.path, expected: w.digest, found: a.digest }); continue; }
    matched += 1;
  }
  const expectedPaths = new Set(want.map((w) => w.path));
  const extra = [...have.keys()].filter((p) => !expectedPaths.has(p));
  return {
    ok: missing.length === 0 && altered.length === 0,
    reason: missing.length || altered.length
      ? `${missing.length} missing, ${altered.length} altered`
      : null,
    missing,
    altered,
    // Reported, never fatal: a destination may hold older snapshots, and that is not corruption.
    extra,
    matched,
  };
}

/** One line per decision, for a reader rather than a log. */
function lines(p) {
  const out = [
    `MATSYA — ${p.totals.considered} file(s) considered`,
    `  copy as-is (already ciphertext): ${p.totals.ciphertext}`,
    `  re-encrypt before sending:       ${p.totals.encrypt}`,
    `  refused outright:                ${p.totals.never}`
      + (p.totals.unmatched ? ` (${p.totals.unmatched} because no rule covers them)` : ''),
  ];
  for (const r of p.refuse) out.push(`  REFUSED ${r.path} — ${r.why}`);
  return out;
}

module.exports = { classify, plan, manifest, verify, lines, RULES, CLASSES };
