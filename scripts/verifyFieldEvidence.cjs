'use strict';
/**
 * verifyFieldEvidence.cjs - the field report is off by default, honest about what it has not seen,
 * and cannot reach outward (Section 171)
 *
 * Four things are proven, and the first two are the ones that make this component safe to exist:
 *
 *   OFF           the flag fails closed. An absent, misspelt, non-string or truthy-but-wrong value
 *                 resolves to `off`. Nothing is recorded and nothing is written while it is off.
 *   SEPARATE      recording and sending are different permissions. `local` never ships.
 *   HONEST        `inspected` is never promoted to `observed`; `never-observed` is never rendered
 *                 as a pass; a refutation is reported as a finding rather than as a gap.
 *   CONTAINED     the pure module requires nothing, touches no filesystem, no network, no
 *                 `child_process`. A collector of facts about master's machine that cannot reach
 *                 the network cannot exfiltrate them, and that is the guarantee in structural form.
 *
 * Run: node scripts/verifyFieldEvidence.cjs   (or npm run verify:field-evidence)
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

const fe = require(path.join(ROOT, 'electron/lib/fieldEvidence.cjs'));
const SRC = fs.readFileSync(path.join(ROOT, 'electron/lib/fieldEvidence.cjs'), 'utf8');
const CLI = fs.readFileSync(path.join(ROOT, 'scripts/fieldReport.cjs'), 'utf8');
const SPEC = fs.readFileSync(path.join(ROOT, 'RAMA_AGI_MASTER_SPEC.md'), 'utf8');

(async () => {
  console.warn('\nfield evidence - off unless master says otherwise, and honest about the difference between "fine" and "unseen"\n');

  section('OFF: the flag fails closed');
  for (const [label, src] of [
    ['nothing at all', {}],
    ['undefined', undefined],
    ['null', null],
    ['an empty string', { env: '' }],
    ['whitespace', { env: '   ' }],
    ['a misspelling', { env: 'locale' }],
    ['"yes"', { env: 'yes' }],
    ['"true"', { env: 'true' }],
    ['"on"', { env: 'on' }],
    ['"1"', { env: '1' }],
    ['boolean true', { env: true }],
    ['the number 1', { env: 1 }],
    ['an object', { env: { mode: 'ship' } }],
    ['an array', { env: ['ship'] }],
    ['a truthy config that is not a mode', { config: true }],
    ['"enabled" in config', { config: 'enabled' }],
  ]) check(`${label} resolves to off`, fe.readMode(src) === 'off', String(fe.readMode(src)));
  check('only the three literal modes are accepted', fe.MODES.join() === 'off,local,ship');
  check('the literals do resolve, so the check above is not vacuous',
    fe.readMode({ env: 'local' }) === 'local' && fe.readMode({ env: 'ship' }) === 'ship' && fe.readMode({ env: 'off' }) === 'off');
  check('case and surrounding space do not defeat it', fe.readMode({ env: '  SHIP ' }) === 'ship');
  check('config is read when the environment is silent', fe.readMode({ config: 'local' }) === 'local');
  check('the environment wins, so the build machine can be asked', fe.readMode({ env: 'local', config: 'ship' }) === 'local');
  // A typo in the environment must not silently hand the decision to stored config.
  check('an unrecognised environment value does NOT fall through to config', fe.readMode({ env: 'shipp', config: 'ship' }) === 'off');

  section('SEPARATE: recording and sending are different permissions');
  check('off is not on', fe.isOn('off') === false && fe.maySend('off') === false);
  check('local records but never sends', fe.isOn('local') === true && fe.maySend('local') === false);
  check('ship records and may send', fe.isOn('ship') === true && fe.maySend('ship') === true);
  check('an unknown mode neither records nor sends', fe.isOn('wat') === false && fe.maySend('wat') === false);
  check('and nothing can be recorded at all while off', fe.record({}, { id: 'kite-session', state: 'observed' }, 'off').accepted === false);
  check('the refusal says why', /is off/.test(fe.record({}, { id: 'kite-session', state: 'observed' }, 'off').reason));

  section('recording: what is refused, and that nothing is mutated');
  const base = Object.freeze({});
  check('an unknown claim is refused: a claim must be declared beside the row it closes',
    fe.record(base, { id: 'invented', state: 'observed' }, 'local').accepted === false);
  check('never-observed cannot be recorded, so a real observation cannot be overwritten with nothing',
    fe.record(base, { id: 'kite-session', state: 'never-observed' }, 'local').accepted === false);
  check('a nonsense state is refused', fe.record(base, { id: 'kite-session', state: 'probably' }, 'local').accepted === false);
  check('no entry at all is refused', fe.record(base, null, 'local').accepted === false && fe.record(base, 'x', 'local').accepted === false);
  check('a refusal returns the ledger UNCHANGED rather than a half-written one',
    Object.keys(fe.record({ a: 1 }, { id: 'nope', state: 'observed' }, 'local').ledger).join() === 'a');
  const r1 = fe.record({}, { id: 'kite-session', state: 'observed', at: '2026-11-02T00:00:00.000Z' }, 'local');
  check('a valid record is accepted', r1.accepted === true && r1.ledger['kite-session'].state === 'observed');
  check('and the original is not mutated: a caller cannot rewrite history through a held reference', (() => {
    const held = {};
    fe.record(held, { id: 'kite-session', state: 'observed' }, 'local');
    return Object.keys(held).length === 0;
  })());
  check('a malformed timestamp is dropped rather than stored as fact', fe.record({}, { id: 'kite-session', state: 'observed', at: 'yesterday' }, 'local').ledger['kite-session'].at === null);
  check('all three recordable states are accepted', ['observed', 'inspected', 'refuted'].every((s) => fe.record({}, { id: 'kite-session', state: s }, 'local').accepted));

  section('shapes and counts, never values');
  // Token-SHAPED but not a token: patterned, built by concatenation, and every piece kept under
  // the 32-character length at which the I-SECRETS scanner starts looking. The first version of
  // this fixture used a fragment of a REAL token, and that scanner caught it - which is its job,
  // and the reason it is not worth widening its allowlist to accommodate a test.
  const SECRET = 'gh' + 'p_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M';
  const s1 = fe.shapeOnly({ count: 4312, ok: true, kdf: 'argon2id', token: SECRET, home: 'C:/Users/someone/x', price: 1234.5 });
  check('counts, booleans and short identifiers survive', s1.detail.count === 4312 && s1.detail.ok === true && s1.detail.kdf === 'argon2id' && s1.detail.price === 1234.5);
  check('a token does not', !('token' in s1.detail) && s1.dropped.includes('token'));
  check('a filesystem path does not', !('home' in s1.detail) && s1.dropped.includes('home'));
  check('a long hex digest does not', fe.shapeOnly({ d: 'b6d4acc97853d61f1464e40a4f2b31bf' }).dropped.includes('d'));
  // Mutation found that three overlapping rules guard this, and the tests above only ever exercised
  // one of them at a time - so widening the length cap or deleting the token-shape test survived.
  // Each of the next two cases is caught by exactly ONE rule, so each rule is now load-bearing.
  check('a long value only the LENGTH cap can catch is dropped', (() => {
    const dotted = 'a.very.long.dotted.value.that.keeps.on.going';   // 44 chars; not hex, not token-shaped
    return dotted.length > 24 && !/^[A-Fa-f0-9]{16,}$/.test(dotted) && !/^[A-Za-z0-9+/=_-]{20,}$/.test(dotted)
      && fe.shapeOnly({ v: dotted }).dropped.includes('v');
  })());
  check('a short value only the TOKEN-SHAPE test can catch is dropped', (() => {
    const key = 'abc123def456ghi789jk';   // 20 chars, so the length cap lets it by
    return key.length <= 24 && !/^[A-Fa-f0-9]{16,}$/.test(key)
      && fe.shapeOnly({ v: key }).dropped.includes('v');
  })());
  check('a nested object does not', fe.shapeOnly({ o: { a: 1 } }).dropped.includes('o'));
  check('an array does not', fe.shapeOnly({ a: [1, 2] }).dropped.includes('a'));
  check('a non-finite number does not', fe.shapeOnly({ n: Infinity }).dropped.includes('n') && fe.shapeOnly({ n: NaN }).dropped.includes('n'));
  check('a function does not', fe.shapeOnly({ f: () => 1 }).dropped.includes('f'));
  check('it never throws on junk', (() => {
    try { fe.shapeOnly(null); fe.shapeOnly(undefined); fe.shapeOnly('str'); fe.shapeOnly([1]); return true; } catch { return false; }
  })());
  check('and nothing withheld is laundered in anyway', !JSON.stringify(s1.detail).includes(SECRET));
  check('the count of withheld fields is recorded, so the report can say how much it held back',
    fe.record({}, { id: 'kite-session', state: 'observed', detail: { token: SECRET, p: '/home/x/y' } }, 'local').ledger['kite-session'].withheld === 2);

  section('HONEST: never-observed is never a pass, and inspected is never promoted');
  const blank = fe.assess({});
  check('an empty ledger reports every claim as never-observed', blank.summary.neverObserved === fe.CLAIMS.length && blank.summary.observed === 0);
  check('and closes none of them', blank.summary.closed === 0 && blank.summary.open === fe.CLAIMS.length);
  const needsRun = fe.CLAIMS.find((c) => c.bar === 'observed');
  const needsArtefact = fe.CLAIMS.find((c) => c.bar === 'inspected');
  check('an inspected artefact does NOT close a row that needs a real run', (() => {
    const a = fe.assess({ [needsRun.id]: { state: 'inspected', detail: {} } });
    const row = a.rows.find((r) => r.id === needsRun.id);
    return row.state === 'inspected' && row.closes === false;
  })(), needsRun.id);
  check('a real run DOES close it', fe.assess({ [needsRun.id]: { state: 'observed', detail: {} } }).rows.find((r) => r.id === needsRun.id).closes === true);
  check('and a real run also satisfies a row that only needed an artefact, because observed is stronger',
    fe.assess({ [needsArtefact.id]: { state: 'observed', detail: {} } }).rows.find((r) => r.id === needsArtefact.id).closes === true);
  check('a refutation never closes anything', fe.assess({ [needsArtefact.id]: { state: 'refuted', detail: {} } }).rows.find((r) => r.id === needsArtefact.id).closes === false);
  check('and a refutation is counted apart from never having looked', (() => {
    const a = fe.assess({ [needsArtefact.id]: { state: 'refuted', detail: {} } });
    return a.summary.refuted === 1 && a.summary.neverObserved === fe.CLAIMS.length - 1;
  })());
  check('an unreadable state is treated as no evidence, not as evidence',
    fe.assess({ [needsRun.id]: { state: 'definitely-fine' } }).rows.find((r) => r.id === needsRun.id).state === 'never-observed');
  check('a state of never-observed stored by hand is still never-observed',
    fe.assess({ [needsRun.id]: { state: 'never-observed' } }).rows.find((r) => r.id === needsRun.id).closes === false);
  check('assess never throws on a junk ledger', (() => {
    try { fe.assess(null); fe.assess([1]); fe.assess('x'); fe.assess({ 'kite-session': null }); return true; } catch { return false; }
  })());
  check('unknown ids in the stored ledger are ignored rather than reported as claims',
    fe.assess({ 'something-else': { state: 'observed' } }).rows.length === fe.CLAIMS.length);
  check('the state ladder puts never-observed at the bottom and observed at the top',
    fe.STATES[0] === 'never-observed' && fe.STATES[fe.STATES.length - 1] === 'observed');
  check('and never-observed is not recordable', !fe.RECORDABLE.includes('never-observed'));

  section('the claim registry is tied to real ledger rows');
  // THE BUG THIS CHECK EXISTS FOR: the first version of the registry cited spec LINE numbers as if
  // they were ledger row numbers. Both are four digits in one case and three in the other, so it
  // read plausibly and pointed master at nothing. Now every row is confirmed to exist.
  const ledgerRows = new Set();
  for (const line of SPEC.split('\n')) {
    const m = /^\|\s*(\d+)\s*\|/.exec(line);
    if (m) ledgerRows.add(Number(m[1]));
  }
  check('the spec ledger was parsed at all', ledgerRows.size > 150, String(ledgerRows.size));
  for (const c of fe.CLAIMS) check(`claim ${c.id} cites ledger row ${c.row}, and that row exists`, ledgerRows.has(c.row));
  check('every claim id is unique', new Set(fe.CLAIM_IDS).size === fe.CLAIMS.length);
  check('every claim has a bar that is a recordable state', fe.CLAIMS.every((c) => fe.RECORDABLE.includes(c.bar)));
  check('no claim sets its bar to refuted: a bar is what would CLOSE a row', fe.CLAIMS.every((c) => c.bar !== 'refuted'));
  check('every claim has a title a human can read', fe.CLAIMS.every((c) => typeof c.title === 'string' && c.title.length > 15));
  check('claimOf finds a declared claim and refuses an invented one', !!fe.claimOf('kite-session') && fe.claimOf('nope') === null);
  check('both kinds of claim exist, so neither branch is dead',
    fe.CLAIMS.some((c) => c.bar === 'inspected') && fe.CLAIMS.some((c) => c.bar === 'observed'));

  section('the report');
  const loaded = fe.assess({
    [needsArtefact.id]: { state: 'refuted', detail: { assets: 0 } },
    [needsRun.id]: { state: 'observed', at: '2026-11-02T00:00:00.000Z', detail: { count: 4312 }, withheld: 2 },
  });
  const rep = fe.lines(loaded, 'local');
  check('it leads with the headline', /^FIELD EVIDENCE/.test(rep[0]));
  check('it states the mode, so a reader knows whether anything travelled', rep.some((l) => /mode: local/.test(l)));
  check('a refutation is reported as a finding, above the gaps', (() => {
    const iRef = rep.findIndex((l) => /^CONTRADICTED/.test(l));
    const iOpen = rep.findIndex((l) => /^STILL OPEN/.test(l));
    return iRef >= 0 && iOpen > iRef;
  })());
  check('and it is not listed again as merely open', (rep.filter((l) => l.includes(needsArtefact.title)).length) === 1);
  check('the open list says plainly that it is work not yet done, not a failure', rep.some((l) => /nothing here is a failure/.test(l)));
  check('an open item names what would close it', rep.some((l) => /needs a real (run|artefact)/.test(l)));
  check('a confirmed item shows its shape detail', rep.some((l) => /count=4312/.test(l)));
  check('withheld fields are declared rather than silently dropped', rep.some((l) => /withheld as not shape-only/.test(l)));
  check('local says it stays on this machine', rep.some((l) => /stays on this machine/.test(l)));
  check('and ship does NOT claim that', !fe.lines(loaded, 'ship').some((l) => /stays on this machine/.test(l)));
  check('a fully blank report still says what it is looking for', fe.lines(blank, 'local').some((l) => /STILL OPEN/.test(l)));
  check('lines never throws', (() => { try { fe.lines(fe.assess({}), 'off'); fe.lines(fe.assess({}), undefined); return true; } catch { return false; } })());

  section('CONTAINED: the pure module cannot reach outward');
  const stripped = SRC.replace(/\/\/.*|\/\*[\s\S]*?\*\//g, '');
  check('it requires nothing at all', !/\brequire\s*\(/.test(SRC));
  check('no filesystem', !/readFile|writeFile|existsSync|readdir|mkdir|unlink/.test(stripped));
  check('no network: no http client, no net, no dns, no tls, no fetch', !/http|net'|dns|tls|fetch\(/.test(stripped));
  check('no process spawning', !/child_process|spawnSync|execSync|execFile|\bspawn\s*\(/.test(stripped));
  // Not "the word git does not appear" - `git-push-ui` is a legitimate CLAIM NAME, and asserting
  // the absence of a word would have failed on it. What must be absent is a transport.
  check('no transport: no git client and no plumbing of its own', !/simpleGit|simple-git|hash-object|commit-tree|update-ref|execFileSync/.test(stripped));
  check('no console.log', !/console\.log/.test(SRC));
  check('nothing it exports can act: the surface is flag reading, recording and analysis',
    Object.keys(fe).sort().join() === 'CLAIMS,CLAIM_IDS,MODES,RECORDABLE,STATES,assess,claimOf,isOn,lines,maySend,readMode,record,shapeOnly',
    Object.keys(fe).sort().join());
  check('the claim registry is frozen, so it cannot be widened at runtime', Object.isFrozen(fe.CLAIMS) && Object.isFrozen(fe.MODES) && Object.isFrozen(fe.STATES));

  section('the collector script: off writes nothing, and only ship sends');
  check('it refuses to do anything while off', /if \(!fe\.isOn\(mode\)\)/.test(CLI) && /nothing was recorded and nothing was written/.test(CLI));
  // BEHAVIOURAL, not positional. "Off writes nothing" is the guarantee the whole feature rests on,
  // and an earlier version of this check asserted the ORDER of two lines - which passed happily and
  // then broke the moment the write moved into a helper, having proven nothing about behaviour.
  // So: actually run it with the flag off and confirm the disk did not change.
  check('running it with the flag off changes nothing on disk', (() => {
    const { spawnSync } = require('child_process');
    const dataDir = path.join(ROOT, 'data');
    const logDir = path.join(dataDir, 'logs');
    const snap = () => {
      const list = (d) => { try { return fs.readdirSync(d).sort().join(); } catch { return '<none>'; } };
      const stamp = (f) => { try { return String(fs.statSync(f).mtimeMs); } catch { return '<none>'; } };
      return `${list(logDir)}|${stamp(path.join(dataDir, 'field-evidence.json'))}`;
    };
    const before = snap();
    const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts/fieldReport.cjs'), '--mode', 'off'],
      { cwd: ROOT, encoding: 'utf8', timeout: 60_000, env: { ...process.env, RAMA_FIELD_EVIDENCE: '' } });
    const after = snap();
    return r.status === 0 && before === after && /nothing was recorded and nothing was written/.test(r.stdout || '');
  })());
  check('and an unrecognised flag value behaves exactly like off, rather than like local', (() => {
    const { spawnSync } = require('child_process');
    const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts/fieldReport.cjs')],
      { cwd: ROOT, encoding: 'utf8', timeout: 60_000, env: { ...process.env, RAMA_FIELD_EVIDENCE: 'enabled' } });
    return r.status === 0 && /nothing was recorded and nothing was written/.test(r.stdout || '');
  })());
  check('sending is gated on maySend and nothing else', (() => {
    const gates = CLI.match(/fe\.maySend\(mode\)/g) || [];
    const ships = CLI.match(/shipReport\(/g) || [];
    // one definition, one gated call site
    return gates.length === 1 && ships.length === 2;
  })(), `maySend ${(CLI.match(/fe\.maySend\(mode\)/g) || []).length}, shipReport ${(CLI.match(/shipReport\(/g) || []).length}`);
  check('the push is inside shipReport, so it cannot happen on the local path', (() => {
    const i = CLI.indexOf('function shipReport');
    const j = CLI.indexOf('\n}', i);
    const body = CLI.slice(i, j);
    return body.includes("'push'") && (CLI.split("'push'").length - 1) === 1;
  })());
  // Redaction on write is structural only if there is ONE write. Two writes means one of them can
  // later be edited to skip it, which is how the local file ends up carrying master's home path.
  check('there is exactly one write in the whole script', (CLI.match(/fs\.writeFileSync\(/g) || []).length === 1,
    String((CLI.match(/fs\.writeFileSync\(/g) || []).length));
  check('and it redacts, in the same function', (() => {
    const i = CLI.indexOf('function writeRedacted');
    const j = CLI.indexOf('\n}', i);
    const body = i < 0 ? '' : CLI.slice(i, j);
    return body.includes('redact(content)') && body.includes('fs.writeFileSync(file, text');
  })());
  check('both the report and the stored ledger go through it', /writeRedacted\(LEDGER_FILE/.test(CLI) && /writeRedacted\(full, raw\)/.test(CLI));
  check('and what is shipped is what was written, not a second redaction', /shipReport\(written\.text/.test(CLI));
  check('it borrows the proven transport rather than growing its own', /require\(path\.join\(ROOT, 'scripts\/shipLog\.cjs'\)\)/.test(CLI) && /commitViaPlumbing/.test(CLI));
  check('and shipLog actually exports it', typeof require(path.join(ROOT, 'scripts/shipLog.cjs')).commitViaPlumbing === 'function');
  check('it exercises nothing: no login, no unlock, no authenticated call', !/login|unlock|authoriz|apiKey|accessToken/i.test(CLI.replace(/\/\*[\s\S]*?\*\//g, '')));
  check('every collector goes through record(), so the shape-only rule applies to them too', /fe\.record\(next, \{ id, state: r\.state/.test(CLI));
  check('a collector that throws costs its own claim and nothing else', /try \{ r = fn\(\); \} catch \{ r = null; \}/.test(CLI));
  check('the stored ledger lives under data/, which is gitignored', /path\.join\(ROOT, 'data', 'field-evidence\.json'\)/.test(CLI));
  check('no console.log in the script', !/console\.log/.test(CLI));
  // Mutation found this hole: every containment check above was aimed at the PURE module, so the
  // script could quietly acquire an HTTP client and nothing objected. The script is allowed a
  // filesystem and a `git push`; it is NOT allowed a network client of its own (I9 - there is one
  // main-process HTTP client, and a diagnostics collector is not it).
  check('the script has no network client of its own', (() => {
    const bare = CLI.replace(/\/\/.*|\/\*[\s\S]*?\*\//g, '');
    return !/require\(\s*['"](http|https|net|dns|tls|dgram|node:http|node:https|node:net)['"]\s*\)/.test(bare)
      && !/\bfetch\s*\(/.test(bare)
      && !/axios|node-fetch|undici|got\(/.test(bare);
  })());
  check('and its requires are a short, named list', (() => {
    const bare = CLI.replace(/\/\/.*|\/\*[\s\S]*?\*\//g, '');
    const mods = (bare.match(/require\(\s*['"]([^'"]+)['"]\s*\)/g) || []).map((m) => /['"]([^'"]+)['"]/.exec(m)[1]);
    const allowed = new Set(['fs', 'os', 'path', 'child_process']);
    return mods.every((m) => allowed.has(m));
  })(), (CLI.replace(/\/\/.*|\/\*[\s\S]*?\*\//g, '').match(/require\(\s*['"]([^'"]+)['"]\s*\)/g) || []).join(' '));
  check('it is require-safe: running it is behind a main guard', /if \(require\.main === module\)/.test(CLI));
  check('every declared collector names a declared claim', (() => {
    const { COLLECTORS } = require(path.join(ROOT, 'scripts/fieldReport.cjs'));
    return Object.keys(COLLECTORS).every((id) => !!fe.claimOf(id));
  })());
  check('and every collector targets a claim whose bar an artefact can actually meet', (() => {
    const { COLLECTORS } = require(path.join(ROOT, 'scripts/fieldReport.cjs'));
    return Object.keys(COLLECTORS).every((id) => fe.claimOf(id).bar === 'inspected');
  })());

  finished = true;
  console.warn(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((err) => { console.warn('  FAIL  suite crashed: ' + err.stack); finished = true; process.exit(1); });
