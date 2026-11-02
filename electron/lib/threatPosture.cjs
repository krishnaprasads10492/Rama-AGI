'use strict';

/**
 * threatPosture.cjs - what is exposed about THIS installation, read in one place (spec Section 170)
 *
 * WHITE HAT, AND THE GUARANTEE IS STRUCTURAL RATHER THAN A PROMISE. This module requires no HTTP
 * client, no `net`, no `child_process` and writes nothing. It cannot reach outward, so it cannot be
 * turned into a scanner or an attack tool by a later edit, and `scripts/verifyThreatPosture.cjs`
 * holds that shut. It reports; master decides and acts (Section 170.3, D2).
 *
 * WHY A CONSOLIDATION. Every signal here already existed somewhere in this codebase, and none of
 * them was ever read together. The failures this project has actually had were all of that shape:
 * a vault that reported success on a wrong password, a `store:*` channel that accepted any domain,
 * a circuit breaker that could never trip. Detection was never the gap; asking in one place was.
 *
 * A MISSING SIGNAL IS `unknown`, NEVER `clear` (D4). "The tripwire manifest could not be read" and
 * "the tripwire is fine" are different facts, and conflating them turns a security report into a
 * comfortable lie.
 *
 * No finding ever carries a secret - severity, location and remedy only (D5).
 */

// ─── Levels, worst-first ─────────────────────────────────────────────────────────────────────────
// `unknown` sits between clear and watch deliberately. Rolling an all-unknown assessment up to
// `clear` was the first defect this module's own test found: it is precisely the comfortable lie
// D4 forbids. A KNOWN problem (watch) still outranks not knowing.
const LEVELS = Object.freeze(['clear', 'unknown', 'watch', 'exposed', 'compromised']);
const rank = (l) => Math.max(0, LEVELS.indexOf(l));

/** Node lines that are past end of life. The advisory wording is that EOL lines are always affected. */
const EOL_MAJORS = Object.freeze([0, 4, 6, 8, 10, 12, 14, 16, 18, 20]);

const num = (v) => {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(v || ''));
  return m ? Number(m[1]) * 1e6 + Number(m[2]) * 1e3 + Number(m[3]) : null;
};
const majorOf = (v) => {
  const m = /^(\d+)\./.exec(String(v || ''));
  return m ? Number(m[1]) : null;
};

// ─── The assessment ──────────────────────────────────────────────────────────────────────────────
/**
 * @param {object} f gathered facts; every field may be absent, and absence is reported as unknown
 * @param {number} now
 * @returns {{level:string, findings:Array, unknowns:string[], checked:number}}
 */
function assess(f = {}, now = Date.now()) {
  const findings = [];
  const unknowns = [];
  const say = (id, severity, what, why, remedy) => findings.push({ id, severity, what, why, remedy });
  const cannotTell = (id, what) => { unknowns.push(id); findings.push({ id, severity: 'unknown', what, why: 'This could not be read, so it is reported as unknown rather than clear.', remedy: null }); };

  // ── the runtime ────────────────────────────────────────────────────────────────────────────────
  if (!f.nodeVersion) cannotTell('node-version', 'The running Node version could not be determined.');
  else {
    const floor = /^\s*>=\s*(\d+\.\d+\.\d+)/.exec(String(f.nodeFloor || ''));
    if (!floor) cannotTell('node-floor', 'The project does not declare a Node floor, so the runtime cannot be judged.');
    else if (num(f.nodeVersion) < num(floor[1])) {
      say('node-unpatched', 'exposed',
        `Node ${f.nodeVersion} is below the declared floor ${floor[1]}.`,
        'That floor is a security floor: below it the Brotli decoder out-of-bounds write (CVE-2026-111497), the TLS hostname bypasses and the eMudhra CA revocation are all unpatched in the runtime.',
        `Install Node ${floor[1]} or newer, then reinstall node_modules.`);
    }
    const maj = majorOf(f.nodeVersion);
    if (maj !== null && EOL_MAJORS.includes(maj)) {
      say('node-eol', 'exposed',
        `Node ${f.nodeVersion} is on the end-of-life ${maj}.x line.`,
        'An end-of-life line receives no security fixes at all, and the Node project states that EOL versions are always affected when a security release occurs.',
        'Move to a supported line (22 or newer).');
    }
  }

  // ── tamper detection ───────────────────────────────────────────────────────────────────────────
  if (f.tripwire === undefined || f.tripwire === null) cannotTell('tripwire', 'The loyalty tripwire manifest could not be read.');
  else if (f.tripwire.matches === false) {
    say('tripwire-unapproved', 'compromised',
      'A protected file has changed without master recording the change.',
      'The live loyalty digest does not match the approved one. This is either a change master made and has not recorded, or a change he did not make — and nothing here can tell those apart.',
      'Review the diff on the protected files, then record it with verifyLoyaltyTripwire --approve. Rāma must not run that itself.');
  }

  // ── credentials ────────────────────────────────────────────────────────────────────────────────
  if (f.remotes === undefined || f.remotes === null) cannotTell('remotes', 'The git remotes could not be read.');
  else {
    const bad = f.remotes.filter((r) => r && r.hadCredential).map((r) => r.name);
    if (bad.length) {
      say('credential-in-remote', 'exposed',
        `A credential is embedded in the remote address of: ${bad.join(', ')}.`,
        'Anything that prints a remote prints the credential — error text, logs, a shipped transcript — and it cannot be revoked from here.',
        'Git Sync > TOKEN > REMOVE IT FROM THE REMOTE ADDRESS, then revoke that token at github.com/settings/tokens.');
    }
  }

  if (f.tokenState === undefined) cannotTell('token', 'The GitHub token record could not be read.');
  else if (f.tokenState === 'rejected') {
    say('token-rejected', 'watch',
      'GitHub has refused the stored token.',
      'It was revoked, has expired, or is wrong, so push, pull and clone will fail and the credential in use is stale.',
      'Add a replacement in Models > Keys; it is checked with GitHub before it is stored.');
  } else if (f.tokenState === 'expired') {
    say('token-expired', 'watch',
      'The stored GitHub token has passed its expiry date.',
      'It can no longer authenticate, and an expired credential left in place hides the fact that nothing is working.',
      'Add a replacement in Models > Keys.');
  }

  // ── the vault ──────────────────────────────────────────────────────────────────────────────────
  if (f.vault === undefined || f.vault === null) cannotTell('vault', 'The vault state could not be read.');
  else {
    if (f.vault.unreadable === true) {
      say('vault-unreadable', 'exposed',
        'A vault file exists but could not be decrypted.',
        'Either the master password is not the one that sealed it, or the file has been altered. Writes are refused while this holds, so nothing further is lost.',
        'Unlock with the correct master password. If it was never changed, treat the file as tampered with and investigate before writing to it.');
    }
    if (f.vault.weakKdf === true) {
      say('vault-weak-kdf', 'watch',
        'The vault was sealed with scrypt rather than Argon2id.',
        'The contents are still AES-256-GCM encrypted, but a stolen vault file is cheaper to brute-force against than one sealed with Argon2id.',
        'Use a build that includes the argon2 module. The existing vault keeps working either way.');
    }
  }

  // ── secrets at rest in the clear ───────────────────────────────────────────────────────────────
  if (f.envSecrets === undefined || f.envSecrets === null) cannotTell('env', 'The .env file could not be inspected.');
  else if (f.envSecrets.length > 0) {
    say('secret-in-env', 'exposed',
      `${f.envSecrets.length} value(s) in .env look like credentials: ${f.envSecrets.join(', ')}.`,
      'A secret in a plain file is readable by anything running as this user, and it is outside the vault that exists to protect it.',
      'Move them into the vault (Models > Keys) and delete the lines. Nothing in the app reads a credential from .env.');
  }

  // ── the dependency tree ────────────────────────────────────────────────────────────────────────
  if (f.audit === undefined || f.audit === null) cannotTell('audit', 'The dependency advisory count is not known (npm audit needs the registry).');
  else {
    const crit = Number(f.audit.critical || 0);
    const high = Number(f.audit.high || 0);
    if (crit > 0 || high > 0) {
      say('audit-advisories', crit > 0 ? 'exposed' : 'watch',
        `${crit} critical and ${high} high advisories in the dependency tree.`,
        'A known-vulnerable dependency is a published attack path, and the publication is what makes it urgent.',
        'Run npm audit to see them. Take the non-major fixes; a major version change is master\'s decision.');
    }
  }

  // Every finding counts toward the level, `unknown` included, so a blind check can never read as clean.
  const level = findings.reduce((worst, x) => (rank(x.severity) > rank(worst) ? x.severity : worst), 'clear');
  return { level, findings, unknowns, checked: findings.length };
}

// ─── Gathering, through injected readers so nothing here touches the world directly ──────────────
/**
 * @param {object} io every reader is optional; one that throws or is absent yields an unknown
 * @returns {object} facts for `assess`
 */
function gather(io = {}) {
  const tryIt = (fn, fallback) => { try { const v = fn(); return v === undefined ? fallback : v; } catch { return fallback; } };
  return {
    nodeVersion: tryIt(() => io.nodeVersion, null),
    nodeFloor: tryIt(() => io.nodeFloor && io.nodeFloor(), null),
    tripwire: tryIt(() => io.tripwire && io.tripwire(), null),
    remotes: tryIt(() => io.remotes && io.remotes(), null),
    tokenState: tryIt(() => (io.tokenState ? io.tokenState() : undefined), undefined),
    vault: tryIt(() => io.vault && io.vault(), null),
    envSecrets: tryIt(() => io.envSecrets && io.envSecrets(), null),
    audit: tryIt(() => io.audit && io.audit(), null),
  };
}

/** One line per finding, for a terminal report. Never includes a value, only where and what to do. */
function lines(posture) {
  const out = [`SECURITY POSTURE: ${String(posture.level).toUpperCase()}`];
  for (const f of posture.findings) out.push(`  [${f.severity}] ${f.what}${f.remedy ? ` -> ${f.remedy}` : ''}`);
  if (posture.level === 'clear' && posture.findings.length === 0) out.push('  Nothing exposed that this check can see.');
  if (posture.unknowns && posture.unknowns.length) out.push(`  ${posture.unknowns.length} signal(s) could not be read, so this report is incomplete: ${posture.unknowns.join(', ')}`);
  return out;
}

module.exports = { assess, gather, lines, LEVELS, EOL_MAJORS };
