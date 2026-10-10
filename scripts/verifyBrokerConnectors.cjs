'use strict';

/**
 * verifyBrokerConnectors.cjs — the connector table, and the promise it must not break.
 *
 * THE ROW THAT MATTERS MOST is that NO connector declares an order path. `verifyGlossary.mjs` already
 * asserts no order channel exists and the help screen tells master Rama never places orders. A broker
 * credential puts order placement one function call away from that promise, so the refusal has to be
 * asserted rather than remembered.
 *
 * THE SECOND is that `driftReport` is INCONCLUSIVE on a failed fetch rather than clean. A short body
 * — a login wall, a redirect, an outage — reading as "every field still present" is the exact quiet
 * failure the function exists to prevent.
 *
 * Run: node scripts/verifyBrokerConnectors.cjs   (or npm run verify:brokers)
 */

const bc = require('../electron/lib/brokerConnectors.cjs');

let pass = 0;
let fail = 0;
const check = (label, ok, detail) => {
  if (ok) { pass += 1; console.log(`  PASS  ${label}`); }
  else { fail += 1; console.log(`  FAIL  ${label}${detail ? ` - ${detail}` : ''}`); }
};
const eq = (label, got, want) => check(label, got === want,
  `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

console.log('\nbroker connectors — declared, verified, never self-applied\n');

// ── The table itself ─────────────────────────────────────────────────────────
console.log('  the declaration');
{
  check('the table is frozen', Object.isFrozen(bc.CONNECTORS));
  check('at least one connector is declared', bc.CONNECTORS.length >= 1);
  check('ids are unique',
    new Set(bc.ids()).size === bc.ids().length, bc.ids().join(','));

  for (const c of bc.CONNECTORS) {
    // PROVENANCE IS NOT OPTIONAL. A field list with no source and no date is a guess wearing a
    // table's clothes. REDBY: drop docsUrl or docsCheckedAt from any connector.
    check(`${c.id} cites the document it was read from`, /^https:\/\//.test(c.docsUrl || ''), c.docsUrl);
    check(`${c.id} records WHEN that document was read`,
      /^\d{4}-\d{2}-\d{2}$/.test(c.docsCheckedAt || ''), c.docsCheckedAt);
    check(`${c.id} is frozen`, Object.isFrozen(c) && Object.isFrozen(c.fields));

    // THE PROMISE. REDBY: add '/orders' to any connector's paths, and this goes red.
    check(`${c.id} declares NO order path — the no-order promise holds`,
      bc.declaresOrderPath(c) === false, JSON.stringify(c.paths));
    eq(`${c.id} is marked data-only`, c.dataOnly, true);

    for (const f of c.fields) {
      check(`${c.id}.${f.key} uses a declared field kind`,
        bc.FIELD_KINDS.includes(f.kind), f.kind);
      // A CREDENTIAL VALUE MUST NEVER BE A PROPERTY OF THIS TABLE. REDBY: add a `value` to a field.
      check(`${c.id}.${f.key} carries no value, only a description`,
        !('value' in f) && !('token' in f) && !('secretValue' in f), Object.keys(f).join(','));
    }
    // A secret must be MARKED, so a renderer can mask it and the egress boundary can refuse it.
    const secrets = c.fields.filter((f) => f.kind === 'secret');
    check(`${c.id}'s secret fields are all flagged secret`,
      secrets.every((f) => f.secret === true), JSON.stringify(secrets.map((f) => f.key)));
    check(`${c.id} needs at least one secret, so the form is honest about what it is asking for`,
      secrets.length >= 1);
  }

  // The order regex must actually catch what it claims to. REDBY: weaken ORDER_PATH.
  for (const p of ['/orders', '/order/place', '/gtt', '/trade', '/orders/cancel', '/squareoff']) {
    check(`ORDER_PATH catches ${p}`, bc.ORDER_PATH.test(p));
  }
  for (const p of ['/quote', '/historical', '/instruments', '/marketfeed/depth']) {
    check(`ORDER_PATH does NOT catch the read path ${p}`, bc.ORDER_PATH.test(p) === false);
  }
}

// ── fieldsFor: the form, and nothing but the form ────────────────────────────
console.log('\n  fieldsFor — what master is asked to fill in');
{
  const f = bc.fieldsFor('dhan');
  check('a known connector yields a form', f.ok === true && Array.isArray(f.fields));
  check('and the form carries the doc URL and date, beside the boxes',
    /^https:\/\//.test(f.docsUrl) && /^\d{4}-\d{2}-\d{2}$/.test(f.docsCheckedAt));
  check('a URL field suggests a default without storing one',
    f.fields.some((x) => x.kind === 'url' && typeof x.suggested === 'string'));
  check('a secret field suggests nothing',
    f.fields.filter((x) => x.secret).every((x) => x.suggested === null));
  check('the returned form contains no value field at all',
    f.fields.every((x) => !('value' in x)));

  // The Dhan split is the operative recommendation, so it must reach the form.
  check('the data-only split is surfaced where master decides',
    typeof f.splitNote === 'string' && /data/i.test(f.splitNote), f.splitNote);

  const bad = bc.fieldsFor('nosuchbroker');
  check('an unknown connector is refused with a reason, not an empty form',
    bad.ok === false && typeof bad.error === 'string', JSON.stringify(bad));
  for (const junk of [null, undefined, '', 42, {}]) {
    check(`fieldsFor(${JSON.stringify(junk)}) refuses`, bc.fieldsFor(junk).ok === false);
  }
}

// ── driftReport: verify the declaration, propose, never apply ────────────────
console.log('\n  driftReport — the docs check');
{
  const dhan = bc.connector('dhan');
  const body = (extra = '') => `${'DhanHQ API documentation. '.repeat(20)}`
    + `${dhan.fields.map((x) => x.key).join(' ')} ${dhan.paths.join(' ')} ${extra}`;

  const clean = bc.driftReport('dhan', body());
  check('a document mentioning every field and path shows no drift',
    clean.ok === true && clean.inconclusive === false && clean.drifted === false,
    JSON.stringify(clean));
  check('and it proposes nothing when nothing changed', clean.proposal === null);

  // THE FINDING THAT MATTERS: a field master would be asked for that the broker has removed.
  // REDBY: stop comparing fields, and this goes green while the form asks for a dead parameter.
  const withoutToken = body().replace(/accessToken/g, 'xxxx');
  const drift = bc.driftReport('dhan', withoutToken);
  check('a removed field is detected',
    drift.drifted === true && drift.missingFields.includes('accessToken'), JSON.stringify(drift));
  // The sentence is asserted verbatim rather than by a loose pattern: a first version of this row
  // used /not(hing)? (been )?changed automatically/ and went red against the real text, which says
  // "Nothing HAS been changed automatically". A pattern that nearly matches is how a row passes on
  // wording that no longer says what it was written to guarantee.
  check('and the proposal names it and states that nothing has been changed automatically',
    typeof drift.proposal === 'string' && drift.proposal.includes('accessToken')
    && drift.proposal.includes('Nothing has been changed automatically'), drift.proposal);

  const withoutPath = body().replace(/\/charts\/historical/g, '/charts/gone');
  const pathDrift = bc.driftReport('dhan', withoutPath);
  check('a removed endpoint is detected',
    pathDrift.drifted === true && pathDrift.missingPaths.includes('/charts/historical'),
    JSON.stringify(pathDrift.missingPaths));

  // A FAILED FETCH IS INCONCLUSIVE, NOT CLEAN. REDBY: treat a short body as agreement.
  for (const [label, doc] of [['an empty body', ''], ['a redirect stub', 'Moved.'], ['null', null]]) {
    const r = bc.driftReport('dhan', doc);
    check(`${label} is INCONCLUSIVE rather than all-clear`,
      r.ok === true && r.inconclusive === true && r.drifted === undefined
      && /NOT agreement/i.test(r.reason), JSON.stringify(r));
  }

  // IT PROPOSES. IT DOES NOT APPLY. REDBY: return a rewritten connector from driftReport.
  const keys = Object.keys(drift).join(',');
  check('the report returns no rewritten connector, patch or diff — I6 holds',
    !/(patch|rewrite|apply|newConnector|updated|fields\b)/i.test(keys.replace('missingFields', '')),
    keys);
  check('and the declared table is unchanged after a drift report',
    bc.connector('dhan').fields.some((x) => x.key === 'accessToken'));

  // Order paths in the DOCS are expected; recording them shows the connector stayed narrower.
  const wide = bc.driftReport('dhan', `${body()} /orders /orders/cancel`);
  check('order paths present in the docs are recorded, not treated as drift',
    wide.drifted === false && wide.orderPathsSeen.length >= 1,
    JSON.stringify(wide.orderPathsSeen));
  check('and the connector still declares none of them',
    bc.declaresOrderPath(bc.connector('dhan')) === false);

  check('an unknown connector is refused', bc.driftReport('nope', body()).ok === false);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
