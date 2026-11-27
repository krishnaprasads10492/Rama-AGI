'use strict';

/**
 * verifyMatsyaPhrase.cjs — the record, the refusals, and proof the phrase is not written down
 * (spec Section 203).
 *
 * THE ONE CLAIM THAT MATTERS MOST is negative: generating a phrase must leave no copy of it on the
 * machine. A claim like that cannot be checked by reading the code and hoping, so this suite RUNS the
 * command in a scratch directory, captures the phrase it printed, and then searches everything the
 * command wrote for that exact string. If it is there, this fails.
 *
 * The second claim is about a loss nothing else would notice: a second phrase does not replace the
 * first, it orphans every snapshot made with it, silently and permanently. The refusal that prevents
 * that is driven here rather than described.
 *
 * Run: node scripts/verifyMatsyaPhrase.cjs   (or npm run verify:matsya-phrase)
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const rec = require(path.join(ROOT, 'electron/lib/matsyaPhraseRecord.cjs'));
const mk = require(path.join(ROOT, 'electron/lib/matsyaKey.cjs'));
const CLI = path.join(ROOT, 'scripts/matsyaPhrase.cjs');

let pass = 0;
let fail = 0;
function check(label, ok, detail) {
  if (ok) { pass += 1; console.log(`  PASS  ${label}`); return; }
  fail += 1;
  console.log(`  FAIL  ${label}${detail ? ` - ${detail}` : ''}`);
}
function eq(label, actual, expected) {
  check(label, actual === expected, `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}
const section = (t) => console.log(`\n  ${t}`);

console.log('\nRama Matsya — the phrase record, and proof the phrase is not kept');

// ═══ (1) Reading the record ═══════════════════════════════════════════════
section('a record is read, and "cannot read it" is not the same as "there is none"');

eq('no file means no record', rec.readRecord({ readText: () => null }).present, false);
eq('an empty file means no record', rec.readRecord({ readText: () => '   ' }).present, false);

const good = rec.readRecord({ readText: () => JSON.stringify({ fingerprint: 'AAAA-BBBB', createdAt: '2026-01-01' }) });
check('a valid record yields its fingerprint and date',
  good.present && good.fingerprint === 'AAAA-BBBB' && good.createdAt === '2026-01-01' && !good.error);

/*
 * REDBY: treat a read failure as absence. That is the single most dangerous simplification available
 * here — a phrase may well exist and be in use, and reporting "none" invites generating one that
 * orphans every snapshot made with it. Absence and failure are different answers.
 */
const unreadable = rec.readRecord({ readText: () => { throw new Error('EACCES'); } });
check('a file that throws reads as PRESENT with an error, never as absent',
  unreadable.present === true && unreadable.error !== null);
const broken = rec.readRecord({ readText: () => '{ not json' });
check('invalid JSON reads as present-but-broken', broken.present === true && broken.error !== null);
const noFp = rec.readRecord({ readText: () => JSON.stringify({ createdAt: 'x' }) });
check('a record with no fingerprint reads as present-but-broken',
  noFp.present === true && noFp.error !== null);
check('readRecord insists on being given a reader', (() => {
  try { rec.readRecord({}); return false; } catch { return true; }
})());

// ═══ (2) The refusal that protects existing snapshots ════════════════════
section('a second phrase is refused, because it orphans the first phrase\'s snapshots');

eq('with no record, generating is allowed',
  rec.judgeNew({ present: false }, {}).allow, true);
eq('with a record, it is refused', rec.judgeNew(good, {}).allow, false);
/*
 * ASSERTED AGAINST THE EXPLANATION, NOT THE WORD. The first version of this row tested `/orphan/i`,
 * which the FLAG NAME `--i-accept-orphaning-old-snapshots` satisfies all by itself — so deleting the
 * sentence that explains the loss left the row passing on the strength of the opt-out it was meant to
 * justify. The phrase below cannot appear in a flag name.
 */
const refusal = rec.judgeNew(good, {}).reason || '';
check('and the refusal says what would be LOST, not merely that one exists',
  /every snapshot taken with the old one/i.test(refusal), refusal);
check('and that the loss is silent and permanent, which is why it needs saying at all',
  /silently/i.test(refusal) && /permanent/i.test(refusal), refusal);
check('the refusal names the phrase on record, so he can check his paper first',
  /AAAA-BBBB/.test(rec.judgeNew(good, {}).reason || ''));
eq('an explicit confirmation allows it', rec.judgeNew(good, { confirmed: true }).allow, true);

/*
 * REDBY: let the confirmation flag override an UNREADABLE record. "I accept losing snapshots made
 * with the old phrase" is not informed consent when nobody can say what the old phrase was, so this
 * case is refused whatever the caller passes.
 */
eq('an unreadable record is refused even WITH the confirmation',
  rec.judgeNew(unreadable, { confirmed: true }).allow, false);
eq('and so is a broken one', rec.judgeNew(broken, { confirmed: true }).allow, false);

// ═══ (3) What the record may contain ═════════════════════════════════════
section('the record holds a name and nothing else');

const text = rec.recordText('AAAA-BBBB', () => '2026-02-02T00:00:00.000Z');
const parsed = JSON.parse(text);
eq('three fields, no more', Object.keys(parsed).sort().join(','), 'createdAt,fingerprint,format');
eq('and the format is versioned', parsed.format, rec.FORMAT);
check('a fingerprint is required', (() => {
  try { rec.recordText(''); return false; } catch { return true; }
})());

// ═══ (4) Comparing what was typed against what is expected ══════════════
section('three answers, because "no record" is not "wrong phrase"');

eq('the right phrase matches', rec.compare(good, 'AAAA-BBBB').status, 'match');
eq('a different one does not', rec.compare(good, 'CCCC-DDDD').status, 'mismatch');
// REDBY: report a mismatch when there is simply nothing to compare against. That sends him looking
// for a different piece of paper when the one he has may be perfectly correct.
eq('and with no record at all, neither', rec.compare({ present: false }, 'AAAA-BBBB').status, 'no-record');
eq('an unreadable record cannot confirm anything either',
  rec.compare(unreadable, 'AAAA-BBBB').status, 'no-record');
check('a mismatch shows both fingerprints, so the difference is visible',
  /AAAA-BBBB/.test(rec.compare(good, 'CCCC-DDDD').message)
  && /CCCC-DDDD/.test(rec.compare(good, 'CCCC-DDDD').message));

// ═══ (5) THE COMMAND, RUN FOR REAL ══════════════════════════════════════
section('the command itself: run in a scratch directory, then searched for the phrase');

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'rama-matsya-phrase-'));
try {
  const run = (args) => spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    env: { ...process.env, RAMA_MATSYA_DIR: scratch },
  });

  const before = run(['status']);
  check('status reports nothing before anything is generated',
    before.status === 0 && /No recovery phrase/i.test(before.stdout));

  const made = run(['new']);
  eq('new succeeds', made.status, 0);
  const shown = (made.stdout.match(/\b([0-9A-Z]{4}-){8}[0-9A-Z]{2}\b/) || [])[0];
  check('it printed a phrase in the expected shape', typeof shown === 'string', shown || made.stdout.slice(0, 120));
  check('it told him to write it down and that it is shown once',
    /WRITE THIS DOWN/i.test(made.stdout) && /once/i.test(made.stdout));

  /*
   * THE ROW THIS SUITE EXISTS FOR. Everything the command wrote is searched for the exact phrase it
   * printed — and for its unseparated form, since a naive "store it for convenience" would likely
   * strip the dashes.
   */
  const written = fs.readdirSync(scratch)
    .map((f) => fs.readFileSync(path.join(scratch, f), 'utf8'))
    .join('\n');
  const bare = shown ? shown.replace(/-/g, '') : '\u0000';
  check('THE PHRASE APPEARS NOWHERE THE COMMAND WROTE',
    !written.includes(shown) && !written.includes(bare), 'the phrase was persisted');
  check('what it did write is a record with exactly the three allowed fields',
    (() => {
      const r = JSON.parse(fs.readFileSync(path.join(scratch, 'matsya-phrase.json'), 'utf8'));
      return Object.keys(r).sort().join(',') === 'createdAt,fingerprint,format';
    })());
  check('and the fingerprint it recorded is the one for that phrase',
    (() => {
      const r = JSON.parse(fs.readFileSync(path.join(scratch, 'matsya-phrase.json'), 'utf8'));
      return r.fingerprint === mk.parsePhrase(shown).fingerprint;
    })());

  const again = run(['new']);
  check('running new a second time is REFUSED', again.status !== 0 && /REFUSED/.test(again.stdout));
  check('and the refusal explains the orphaning', /orphan/i.test(again.stdout));

  const forced = run(['new', '--i-accept-orphaning-old-snapshots']);
  check('the explicit confirmation does let it through', forced.status === 0);

  const after = run(['status']);
  check('status now names the phrase on record',
    after.status === 0 && /expects phrase/i.test(after.stdout));
  check('and says plainly that a fingerprint is not the phrase',
    /not the phrase/i.test(after.stdout));

  // REDBY: accept `--phrase=` "just this once". Then the warning arrives after the phrase is already
  // in the shell history and the process list.
  const onArgv = run(['check', '--phrase=ABCD-EFGH']);
  check('a phrase offered on the command line is refused',
    onArgv.status !== 0 && /REFUSED/.test(onArgv.stdout));
  check('and the refusal explains why, rather than just saying no',
    /history/i.test(onArgv.stdout) && /process list/i.test(onArgv.stdout));
  check('the refused phrase is not echoed back into the output',
    !onArgv.stdout.includes('ABCD-EFGH'));

  const unknown = run(['frobnicate']);
  check('an unknown command is refused rather than guessed at',
    unknown.status !== 0 && /Unknown command/.test(unknown.stdout));
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}

// ═══ (6) What the command may not become ════════════════════════════════
section('contained: the command cannot send the phrase anywhere');

const cliSrc = fs.readFileSync(CLI, 'utf8');
const stripped = cliSrc.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
check('no network', !/http|net'|fetch\(|request\(/.test(stripped));
check('no process spawning', !/child_process|spawn|exec/.test(stripped));
check('no clipboard', !/clipboard/i.test(stripped));
// REDBY: write the phrase "to a file for convenience". There is exactly one write in this command
// and it writes `recordText`, which cannot contain the phrase.
eq('exactly one write in the whole command', (stripped.match(/writeFileSync/g) || []).length, 1);
check('and it writes the record text, not anything derived from the phrase',
  /writeFileSync\(RECORD_PATH, rec\.recordText\(fingerprint\)/.test(stripped));
check('the record path is the only path it writes to',
  (stripped.match(/writeFileSync\([^)]*/g) || []).every((m) => m.includes('RECORD_PATH')));
check('no console.log in the shipped command', !/console\.log/.test(cliSrc));

console.log('\n  held by hand, listed rather than implied:');
console.log('    - echo suppression uses readline\'s `_writeToOutput`. If a future Node removes it');
console.log('      the command SAYS the terminal will echo rather than leaking silently, but this');
console.log('      suite cannot prove a real terminal hid the characters');
console.log('    - nothing here proves master wrote the phrase on paper, or that the paper still');
console.log('      exists. `check` proves only that what he typed matches what was recorded');
console.log('    - the fingerprint is written in the clear on purpose. It names a phrase and is an');
console.log('      independent HKDF output, so it is not any part of the key (202.2)');

console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'} — ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
