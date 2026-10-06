'use strict';

/**
 * printRepairContract.cjs — the repair contract, rendered for a human (spec Section 137)
 *
 * `render()` is DERIVED from `ENTRIES`, so this file prints a projection and holds no table of its
 * own. There is deliberately no second hand-maintained copy: a renderer with its own list is how a
 * table and its rendering come to disagree about what is in the table.
 *
 * It runs under plain `node` with no Electron, no renderer build and no network, because a contract
 * that can only be read from inside a running app is a contract nobody audits.
 *
 * TWO THINGS THIS OUTPUT IS CAREFUL ABOUT:
 *   - `UNVERIFIED` is printed as that literal word for every entry whose `verification.where` is
 *     `unverifiable-here`, for a null `kind`, and for the legacy value `'not-run'`. None of them ever
 *     prints as a pass.
 *   - `timeoutMs` is printed as a DECLARATION, not a guarantee. `verify()` applies no deadline, and a
 *     declared timeout read by nothing would otherwise be believed.
 *
 * Run: node scripts/printRepairContract.cjs
 */

const path = require('path');

const contract = require(path.join(__dirname, '..', 'electron', 'lib', 'repairContract.cjs'));

const COLUMNS = Object.freeze([
  Object.freeze({ key: 'editId', title: 'edit' }),
  Object.freeze({ key: 'reachable', title: 'reach' }),
  Object.freeze({ key: 'producer', title: 'producer' }),
  Object.freeze({ key: 'scope', title: 'scope' }),
  Object.freeze({ key: 'action', title: 'action' }),
  Object.freeze({ key: 'transform', title: 'transform' }),
  Object.freeze({ key: 'verification', title: 'verification' }),
  Object.freeze({ key: 'approval', title: 'approval' }),
]);

/** Fixed-width, measured from the content, so nothing truncates a value silently. */
function table(rows) {
  const widths = COLUMNS.map((c) => rows
    .reduce((w, r) => Math.max(w, String(r[c.key]).length), c.title.length));
  const line = (cells) => `  ${cells.map((v, i) => String(v).padEnd(widths[i])).join('  ')}`.replace(/\s+$/, '');
  const out = [line(COLUMNS.map((c) => c.title)), line(widths.map((w) => '\u2500'.repeat(w)))];
  for (const r of rows) out.push(line(COLUMNS.map((c) => r[c.key])));
  return out;
}

function main() {
  const rows = contract.render();

  console.log('\nthe repair contract \u2014 one frozen table, derived rendering\n');
  for (const l of table(rows)) console.log(l);

  console.log(`\n  ${contract.censusLine()}`);
  console.log('  a table of six transforms that one sensor can address is not six capabilities\n');

  console.log('  per entry \u2014 trigger, verification and provenance in full\n');
  for (const r of rows) {
    console.log(`    ${r.editId}  [${r.reachable === 'yes' ? 'reachable' : 'unreachable'}]`);
    console.log(`        when         ${r.trigger}`);
    console.log(`        where        ${r.scope}  \u00b7  ${r.action}`);
    console.log(`        verified by  ${r.verification}`);
    console.log(`        timeout      ${r.timeout}`);
    console.log(`        approval     ${r.approval}`);
    console.log(`        provenance   ${r.provenance}`);
  }

  console.log('\n  which verdicts author() can reach on this install\n');
  for (const v of contract.VERDICT_REACHABILITY) {
    console.log(`    ${v.verdict}  [${v.where}]  proved by: ${v.provedBy || 'nothing here'}`);
    console.log(`        ${v.why}`);
  }

  console.log('\n  8.3 short names, as measured\n');
  console.log(`    resolved: ${contract.EIGHT_DOT_THREE.resolved}`);
  for (const r of contract.EIGHT_DOT_THREE.residual) console.log(`    residual: ${r}`);
  console.log(`    owner:    ${contract.EIGHT_DOT_THREE.owner}`);

  console.log('\n  the adjacent gaps \u2014 named, not fixed\n');
  for (const g of contract.ADJACENT_GAPS) {
    console.log(`    ${g.id}  [${g.status}]`);
    console.log(`        ${g.what}`);
    console.log(`        whose: ${g.whose}`);
  }

  console.log('\n  authoring modes: '
    + `${contract.AUTHORING_MODES.join(', ')}  \u00b7  verifiers: ${contract.VERIFIER_KINDS.join(', ')}`);
  console.log('  author() returns a payload. It does not file, dispatch, apply, or write a byte.\n');
}

if (require.main === module) {
  main();
}

module.exports = { table, COLUMNS, main };
