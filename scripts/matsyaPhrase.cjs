#!/usr/bin/env node
'use strict';

/**
 * matsyaPhrase.cjs — generate the recovery phrase once, and check what was written down
 * (spec Section 203, answering the first two items of 202.7).
 *
 *     node scripts/matsyaPhrase.cjs new      # generate, show it, write only its fingerprint
 *     node scripts/matsyaPhrase.cjs check    # type it back; confirms it matches the record
 *     node scripts/matsyaPhrase.cjs status   # which phrase this installation expects
 *
 * THE PHRASE NEVER ARRIVES ON THE COMMAND LINE, and that is not a style preference. Anything in
 * `argv` is in the shell's history file, in `ps` output for every other process on the machine while
 * it runs, and often in a terminal scrollback that gets pasted into a bug report. So `check` reads
 * from the terminal with echo OFF, and a `--phrase=` argument is refused outright rather than
 * accepted "just this once" — if it were accepted, the warning would arrive after the damage.
 *
 * NOTHING IS WRITTEN EXCEPT A FINGERPRINT. The phrase is displayed once and lives on paper; see
 * `matsyaPhraseRecord.cjs` for what the record may contain and why a second phrase is refused.
 *
 * This is the ACT; the judgements are in `lib/matsyaKey.cjs` and `lib/matsyaPhraseRecord.cjs`, where
 * a suite can drive them. The point of keeping this file thin is that the dangerous decisions are
 * somewhere testable, and what remains here is reading a terminal and printing.
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const ROOT = path.resolve(__dirname, '..');
const mk = require(path.join(ROOT, 'electron/lib/matsyaKey.cjs'));
const rec = require(path.join(ROOT, 'electron/lib/matsyaPhraseRecord.cjs'));

const RECORD_DIR = process.env.RAMA_MATSYA_DIR || path.join(ROOT, 'data', 'system');
const RECORD_PATH = path.join(RECORD_DIR, 'matsya-phrase.json');

const io = {
  readText: () => (fs.existsSync(RECORD_PATH) ? fs.readFileSync(RECORD_PATH, 'utf8') : null),
};

function say(line = '') { process.stdout.write(`${line}\n`); }
function rule() { say('─'.repeat(72)); }

/** Read one line from the terminal without echoing it. */
function askSecret(prompt) {
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    // `_writeToOutput` is the documented-by-practice way to suppress echo in readline. If it is not
    // available the prompt still works and the phrase is visible, which is why it is SAID rather
    // than silently degraded — a phrase echoed into a scrollback is a phrase that leaked.
    const quiet = typeof rl._writeToOutput === 'function';
    if (quiet) rl._writeToOutput = () => {};
    else say('\n  (this terminal will echo what you type — nobody should be watching)');
    rl.question('', (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

function cmdStatus() {
  const r = rec.readRecord(io);
  if (!r.present) {
    say('No recovery phrase has been generated on this installation.');
    say('Run:  node scripts/matsyaPhrase.cjs new');
    return 0;
  }
  if (r.error) {
    say(`A phrase record exists here and cannot be read: ${r.error}`);
    say(`File: ${RECORD_PATH}`);
    return 1;
  }
  say(`This installation expects phrase ${r.fingerprint}`);
  if (r.createdAt) say(`Recorded ${r.createdAt}`);
  say('');
  say('That is a fingerprint, not the phrase. It identifies which piece of paper opens the');
  say('snapshots and reveals nothing about what is written on it.');
  return 0;
}

function cmdNew(argv) {
  const confirmed = argv.includes('--i-accept-orphaning-old-snapshots');
  const verdict = rec.judgeNew(rec.readRecord(io), { confirmed });
  if (!verdict.allow) {
    say('REFUSED');
    say('');
    say(verdict.reason);
    return 1;
  }

  const { phrase, fingerprint } = mk.generatePhrase();

  rule();
  say('  WRITE THIS DOWN NOW. IT IS SHOWN ONCE AND STORED NOWHERE.');
  rule();
  say('');
  say(`    ${phrase}`);
  say('');
  say(`  fingerprint  ${fingerprint}`);
  rule();
  say('');
  say('This phrase is the ONLY way to open a Matsya backup. It is not kept on this machine,');
  say('not in the vault, and not recoverable from anything here — that is the point: a backup');
  say('whose key dies with the machine protects you from nothing.');
  say('');
  say('  · write it on paper, not in a file on this computer');
  say('  · keep it somewhere the machine catching fire would not reach');
  say('  · then run:  node scripts/matsyaPhrase.cjs check');
  say('    and type it back, to prove what you wrote is what this expects');
  say('');

  try {
    fs.mkdirSync(RECORD_DIR, { recursive: true });
    fs.writeFileSync(RECORD_PATH, rec.recordText(fingerprint), { mode: 0o600 });
    say(`Recorded the fingerprint only, in ${path.relative(ROOT, RECORD_PATH)}`);
  } catch (err) {
    // The phrase is already on screen and master may already have written it down, so this must not
    // read as "that did not happen". It reports what is true: the phrase is real, the label is not.
    say(`WARNING: the fingerprint could not be recorded (${err.message}).`);
    say('The phrase above is still valid. `check` will not be able to confirm it until a record');
    say('exists, so keep the fingerprint written down beside it.');
    return 1;
  }
  return 0;
}

async function cmdCheck(argv) {
  const offered = argv.find((a) => a.startsWith('--phrase'));
  if (offered) {
    say('REFUSED: the phrase must not be passed as an argument.');
    say('');
    say('Anything on the command line is written to your shell history and is visible in the');
    say('process list to everything else running on this machine. Run `check` with no arguments');
    say('and type it at the prompt instead.');
    return 1;
  }

  const typed = await askSecret('Type the recovery phrase (it will not be shown): ');
  const parsed = mk.parsePhrase(typed);
  if (!parsed.ok) {
    say(`NO: ${parsed.error}`);
    say('');
    say('Nothing was changed. Check the paper and try again — case, spaces and dashes do not');
    say('matter, and O/0 and I/L/1 are treated as the same character.');
    return 1;
  }

  const outcome = rec.compare(rec.readRecord(io), parsed.fingerprint);
  say(outcome.status === 'match' ? 'YES' : outcome.status === 'mismatch' ? 'NO' : 'UNKNOWN');
  say('');
  say(outcome.message);
  if (outcome.status === 'match') {
    say('');
    say('What you wrote down is what this installation expects. A backup made now can be opened');
    say('with that paper on a machine that has never seen this one.');
  }
  return outcome.status === 'match' ? 0 : 1;
}

async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  if (cmd === 'new') return cmdNew(argv);
  if (cmd === 'check') return cmdCheck(argv);
  if (cmd === 'status' || cmd === undefined) return cmdStatus();
  say(`Unknown command "${cmd}".`);
  say('Use: new | check | status');
  return 1;
}

if (require.main === module) {
  main().then((code) => process.exit(code)).catch((err) => {
    say(`matsyaPhrase failed: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { RECORD_PATH };
