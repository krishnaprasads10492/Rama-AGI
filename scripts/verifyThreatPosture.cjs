'use strict';
/**
 * verifyThreatPosture.cjs - the white-hat check reports honestly and cannot reach outward (Section 170)
 *
 * Two things are proven here, and the second matters more than the first:
 *
 *   HONEST      every finding fires on its own signal and not otherwise; a signal that cannot be read
 *               is `unknown` and NEVER rolls up to `clear`; no finding carries a secret
 *   CONTAINED   the module requires no HTTP client, no `net`, no `child_process`, and writes nothing.
 *               A defensive tool that cannot reach the network cannot be turned into a scanner by a
 *               later edit, and that is the white-hat guarantee in structural form rather than a promise.
 *
 * Run: node scripts/verifyThreatPosture.cjs   (or npm run verify:threat-posture)
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
let pass = 0;
let fail = 0;
function check(label, ok, detail) {
  if (ok) { pass += 1; console.warn(`  PASS  ${label}`); } else { fail += 1; console.warn(`  FAIL  ${label}${detail ? ` - ${detail}` : ''}`); }
}
const section = (t) => console.warn(`\n--- ${t} ---`);
let finished = false;
process.on('exit', () => { if (!finished) { console.warn('  FAIL  the suite did not reach its summary'); process.exitCode = 1; } });

const tp = require(path.join(ROOT, 'electron/lib/threatPosture.cjs'));

// A fact set with nothing wrong in it, so each check below changes exactly one thing.
const CLEAN = Object.freeze({
  nodeVersion: '22.23.4',
  nodeFloor: '>=22.23.4',
  tripwire: { matches: true },
  remotes: [{ name: 'origin', hadCredential: false }],
  tokenState: 'ok',
  vault: { unreadable: false, weakKdf: false },
  envSecrets: [],
  audit: { critical: 0, high: 0 },
});
const A = (o) => tp.assess({ ...CLEAN, ...o }, Date.parse('2026-10-22T12:00:00Z'));
const idsOf = (r) => r.findings.map((x) => x.id);
const one = (o, id, severity) => {
  const r = A(o);
  return r.findings.length === 1 && r.findings[0].id === id && r.findings[0].severity === severity && r.level === severity;
};

(async () => {
  console.warn('\nthreat posture - honest about this installation, and unable to reach outward\n');

  section('a clean installation');
  const clean = A({});
  check('nothing is reported', clean.level === 'clear' && clean.findings.length === 0 && clean.unknowns.length === 0, JSON.stringify(idsOf(clean)));

  section('each signal fires on its own, and nothing else fires with it');
  check('an unpatched runtime is exposed', one({ nodeVersion: '22.12.0' }, 'node-unpatched', 'exposed'));
  check('and the finding names the floor and the CVE it leaves open', (() => {
    const f = A({ nodeVersion: '22.12.0' }).findings[0];
    return f.what.includes('22.12.0') && f.what.includes('22.23.4') && /CVE-2026-111497/.test(f.why) && /Install Node/.test(f.remedy);
  })());
  check('an end-of-life line is exposed even when it clears the floor numerically', (() => {
    const r = tp.assess({ ...CLEAN, nodeVersion: '20.19.5', nodeFloor: '>=20.0.0' }, 1);
    return idsOf(r).includes('node-eol') && r.level === 'exposed';
  })());
  check('both fire together on an old EOL runtime', (() => {
    const ids = idsOf(A({ nodeVersion: '20.10.0' }));
    return ids.includes('node-unpatched') && ids.includes('node-eol');
  })());
  check('a tripwire mismatch is COMPROMISED, the worst level there is', one({ tripwire: { matches: false } }, 'tripwire-unapproved', 'compromised'));
  check('and it does not accuse: it says the two readings cannot be told apart', (() => {
    const f = A({ tripwire: { matches: false } }).findings[0];
    return /did not make/.test(f.why) && /nothing here can tell those apart/.test(f.why) && /must not run that itself/.test(f.remedy);
  })());
  check('a credential in a remote is exposed, and names the remote only', (() => {
    const r = A({ remotes: [{ name: 'origin', hadCredential: true }, { name: 'clean', hadCredential: false }] });
    return r.findings.length === 1 && r.findings[0].id === 'credential-in-remote' && r.findings[0].what.includes('origin') && !r.findings[0].what.includes('clean');
  })());
  check('a refused token is a watch', one({ tokenState: 'rejected' }, 'token-rejected', 'watch'));
  check('an expired token is a watch', one({ tokenState: 'expired' }, 'token-expired', 'watch'));
  check('a healthy token says nothing', A({ tokenState: 'ok' }).findings.length === 0 && A({ tokenState: 'no-expiry' }).findings.length === 0);
  check('an undecryptable vault is exposed', one({ vault: { unreadable: true, weakKdf: false } }, 'vault-unreadable', 'exposed'));
  check('a weak vault derivation is a watch', one({ vault: { unreadable: false, weakKdf: true } }, 'vault-weak-kdf', 'watch'));
  check('a secret in .env is exposed, and only its NAME is reported', (() => {
    const r = A({ envSecrets: ['HMAC_SECRET', 'OPENAI_API_KEY'] });
    return r.findings.length === 1 && r.findings[0].id === 'secret-in-env' && r.findings[0].what.includes('HMAC_SECRET') && /2 value/.test(r.findings[0].what);
  })());
  check('critical advisories are exposed, high alone is a watch', one({ audit: { critical: 2, high: 12 } }, 'audit-advisories', 'exposed')
    && one({ audit: { critical: 0, high: 3 } }, 'audit-advisories', 'watch'));
  check('a clean audit says nothing', A({ audit: { critical: 0, high: 0 } }).findings.length === 0);

  section('a signal that cannot be read is never read as clean');
  const blind = tp.assess({}, 1);
  check('nothing readable is UNKNOWN, not clear', blind.level === 'unknown' && blind.level !== 'clear', blind.level);
  check('and every missing signal is listed by name', blind.unknowns.length >= 6 && blind.unknowns.every((u) => typeof u === 'string'), blind.unknowns.join());
  check('a known problem still outranks not knowing', tp.assess({ tokenState: 'rejected' }, 1).level === 'watch');
  check('and a compromise outranks everything', tp.assess({ tripwire: { matches: false } }, 1).level === 'compromised');
  check('unknown sits between clear and watch in the declared ladder', tp.LEVELS.indexOf('unknown') === 1 && tp.LEVELS.indexOf('watch') === 2);
  for (const [name, o] of [['the tripwire manifest', { tripwire: null }], ['the remotes', { remotes: null }], ['the vault', { vault: null }], ['.env', { envSecrets: null }], ['the audit', { audit: null }]]) {
    const r = A(o);
    check(`${name} unreadable is reported as unknown rather than passed over`, r.unknowns.length === 1 && r.level === 'unknown');
  }
  check('a missing node floor is unknown, not a free pass', A({ nodeFloor: null }).unknowns.includes('node-floor'));
  check('an unreadable node version is unknown', A({ nodeVersion: null }).unknowns.includes('node-version'));

  section('no finding ever carries a secret');
  const TOKEN = 'gh' + 'p_' + 'S3cr3tS3cr3tS3cr3tS3cr3tS3cr3tS3cr3t';
  const loaded = tp.assess({
    ...CLEAN,
    nodeVersion: '20.10.0',
    tripwire: { matches: false },
    remotes: [{ name: TOKEN, hadCredential: true }],
    tokenState: 'rejected',
    vault: { unreadable: true, weakKdf: true },
    envSecrets: ['A_TOKEN'],
    audit: { critical: 1, high: 1 },
  }, 1);
  check('every finding fires at once when everything is wrong', loaded.findings.length === 9 && loaded.level === 'compromised', String(loaded.findings.length));
  check('a remedy is offered for every real finding', loaded.findings.every((f) => f.severity === 'unknown' || (typeof f.remedy === 'string' && f.remedy.length > 10)));
  check('a secret handed to it in a fact is not laundered into a finding by the module itself', (() => {
    // The module cannot invent a secret; what it must not do is add one. The remote NAME is caller-
    // supplied here, so the honest assertion is that nothing ELSE in the report carries it.
    const withoutRemote = loaded.findings.filter((f) => f.id !== 'credential-in-remote');
    return !JSON.stringify(withoutRemote).includes(TOKEN);
  })());
  check('no finding quotes a .env VALUE, only its name', !JSON.stringify(loaded.findings).includes('='));

  section('the severity of every finding is pinned, so no later edit can quietly downgrade one');
  // This table is the point of the module: it is the only place that says how bad each thing is,
  // and a severity is the one field a careless edit can change without breaking anything visible.
  // Mutation testing found exactly that hole here — credential-in-remote dropped from `exposed` to
  // `watch` and every other check still passed.
  const SEVERITY = Object.freeze({
    'node-unpatched': 'exposed',
    'node-eol': 'exposed',
    'tripwire-unapproved': 'compromised',
    'credential-in-remote': 'exposed',
    'token-rejected': 'watch',
    'vault-unreadable': 'exposed',
    'vault-weak-kdf': 'watch',
    'secret-in-env': 'exposed',
    'audit-advisories': 'exposed',
  });
  for (const [id, want] of Object.entries(SEVERITY)) {
    const got = loaded.findings.find((f) => f.id === id);
    check(`${id} is reported as ${want} and nothing less`, !!got && got.severity === want, got ? got.severity : 'it was not reported at all');
  }
  check('an expired token is a watch (it does not fire alongside a rejected one)', (() => {
    const f = A({ tokenState: 'expired' }).findings[0];
    return f && f.id === 'token-expired' && f.severity === 'watch';
  })());
  check('the table above covers every finding this module can produce', (() => {
    const covered = new Set([...Object.keys(SEVERITY), 'token-expired']);
    return loaded.findings.every((f) => covered.has(f.id)) && covered.size === 10;
  })(), idsOf(loaded).join());
  check('and each one on its own raises the overall level to its own severity', Object.entries(SEVERITY).every(([id, want]) => {
    const r = A({
      'node-unpatched': { nodeVersion: '22.12.0', nodeFloor: '>=22.23.4' },
      'node-eol': { nodeVersion: '20.19.5', nodeFloor: '>=20.0.0' },
      'tripwire-unapproved': { tripwire: { matches: false } },
      'credential-in-remote': { remotes: [{ name: 'origin', hadCredential: true }] },
      'token-rejected': { tokenState: 'rejected' },
      'vault-unreadable': { vault: { unreadable: true, weakKdf: false } },
      'vault-weak-kdf': { vault: { unreadable: false, weakKdf: true } },
      'secret-in-env': { envSecrets: ['A_TOKEN'] },
      'audit-advisories': { audit: { critical: 1, high: 0 } },
    }[id]);
    return r.level === want && idsOf(r).includes(id);
  }));

  section('gather: a reader that fails costs a signal, never a crash');
  const g = tp.gather({
    nodeVersion: '22.23.4',
    nodeFloor: () => { throw new Error('boom'); },
    tripwire: () => ({ matches: true }),
    remotes: () => { throw new Error('no .git'); },
  });
  check('a throwing reader yields null rather than propagating', g.nodeFloor === null && g.remotes === null);
  check('a working reader is kept', g.tripwire && g.tripwire.matches === true && g.nodeVersion === '22.23.4');
  check('readers that were not supplied are absent, not invented', g.vault === null && g.audit === null);
  check('and the result of an all-failing gather assesses as unknown', tp.assess(tp.gather({}), 1).level === 'unknown');
  check('gather never throws, whatever it is handed', (() => {
    try { tp.gather(); tp.gather(null); tp.gather({ vault: 'not a function' }); return true; } catch { return false; }
  })());

  section('the report');
  const lines = tp.lines(loaded);
  check('it leads with the level', /^SECURITY POSTURE: COMPROMISED$/.test(lines[0]));
  check('every finding gets a line with its severity', lines.filter((l) => /^\s+\[/.test(l)).length === 9);
  check('an incomplete report says so', tp.lines(blind).some((l) => /could not be read, so this report is incomplete/.test(l)));
  check('a clean report says what it checked rather than nothing', tp.lines(clean).some((l) => /Nothing exposed/.test(l)));

  section('CONTAINED: it cannot reach outward');
  const src = fs.readFileSync(path.join(ROOT, 'electron/lib/threatPosture.cjs'), 'utf8');
  check('it requires nothing at all', !/\brequire\s*\(/.test(src));
  check('no HTTP client, no net, no dns, no tls', !/http|net'|dns|tls|fetch\(/.test(src.replace(/\/\/.*|\/\*[\s\S]*?\*\//g, '')));
  check('no process spawning', !/child_process|spawnSync|execSync|execFile|\bspawn\s*\(/.test(src.replace(/\/\/.*|\/\*[\s\S]*?\*\//g, '')));
  check('it writes nothing', !/writeFile|appendFile|mkdir|rmSync|unlink/.test(src));
  check('it reads nothing from disk either: the collectors are injected', !/readFile|existsSync/.test(src));
  check('nothing it exports can act: the surface is analysis only',
    Object.keys(tp).sort().join() === 'EOL_MAJORS,LEVELS,assess,gather,lines'
    && ['assess', 'gather', 'lines'].every((k) => typeof tp[k] === 'function'), Object.keys(tp).sort().join());
  check('no console.log', !/console\.log/.test(src));

  section('the wiring: it reports, it never acts');
  const start = fs.readFileSync(path.join(ROOT, 'start.cjs'), 'utf8');
  const block = (() => {
    const i = start.indexOf('// ── Security posture (Section 170)');
    const j = start.indexOf('return { defects, report, degraded };', i);
    return i >= 0 && j > i ? start.slice(i, j) : '';
  })();
  check('it is wired into the diagnose report at all', block.length > 0 && /threatPosture\.cjs/.test(block));
  check('and it NEVER raises a fatal, so a security observation cannot stop Rāma starting', block.length > 0 && !/severity: 'fatal'/.test(block) && /severity: 'warn'/.test(block));
  check('at most one summary defect, not one per finding', (block.match(/defects\.push\(/g) || []).length === 1);
  check('it remediates nothing', !/npm install|writeFileSync|spawnSync|execSync|set-url/.test(block));
  check('the collectors report names only: the remote name, the env variable name', /hadCredential: \/:\\\/\\\/\[\^\/\\s\]\*@\/\.test/.test(block) && /names\.push\(name\)/.test(block));
  check('a collector failure degrades to a stated unknown rather than a crash', /could not be assessed/.test(block));
  check('the tripwire comparison normalises line endings exactly as the tripwire does', /replace\(\/\\r\\n\/g, '\\n'\)/.test(block));

  finished = true;
  console.warn(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((err) => { console.warn('  FAIL  suite crashed: ' + err.stack); finished = true; process.exit(1); });
