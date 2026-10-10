'use strict';

/**
 * brokerConnectors.cjs — the broker data connectors, DECLARED, and checked against their own docs.
 *
 * Master: *"Rama should be able to verify documents online to update the API structure and update
 * itself to give the fields to actually add URLs and creds to utilise them."*
 *
 * WHY A SCRAPER DOES NOT AUTHOR THIS, which is the whole design decision. Reading a vendor's HTML and
 * generating the field list is the `row.target` failure class this project already paid for: a
 * generator that is confidently wrong produces fields that do not exist, and the first time anyone
 * notices is when master pastes a credential into a box for a parameter the broker never had. So the
 * structure is DECLARED DATA — the same shape `autonomyPolicy.cjs` and `repairContract.cjs` use — and
 * the docs are used to VERIFY the declaration and report DRIFT.
 *
 * Declare, verify, propose. Never scrape and trust.
 *
 * AND IT PROPOSES, IT DOES NOT SELF-APPLY. I6 and I17 are intact: `driftReport()` returns findings and
 * writes nothing. "Update itself" means Rama notices the doc moved and tells master exactly what
 * changed; it does not rewrite its own connector table, because a connector silently re-shaped from a
 * page that could have changed for any reason is a credential pointed somewhere new.
 *
 * DATA ONLY, AND THE REASON IS A PROMISE ALREADY MADE. `verifyGlossary.mjs` asserts no order channel
 * exists, and the help screen tells master Rama never places orders. A broker credential puts order
 * placement one function call away from that promise. So every connector here is `dataOnly`, every
 * declared path is checked against `ORDER_PATH` before it is accepted, and the suite fails if any
 * connector ever declares one. Where a broker splits the two — Dhan's Data API is separate from its
 * trading API — the split is recorded so master can take the narrower key.
 *
 * CREDENTIALS ARE NAMED HERE AND STORED NOWHERE. This file declares WHICH fields a broker needs; the
 * values belong to `credentialVault.cjs`. No secret is ever a property of a connector, and
 * `fieldsFor()` returns a form description, never a value. A field is additionally marked `secret` so
 * a renderer can mask it and the egress boundary can refuse to let it leave.
 */

/** A path that places, modifies or cancels an order. Declared so the refusal is data, not vigilance. */
const ORDER_PATH = /(^|\/)(orders?|place|trade|gtt|basket|cancel|modify|exit|squareoff|square-off)(\/|$)/i;

/** What a connector field may be. A free-text `kind` is how a form becomes unvalidatable. */
const FIELD_KINDS = Object.freeze(['url', 'text', 'secret']);

/**
 * THE DECLARED CONNECTORS.
 *
 * `docsUrl` and `docsCheckedAt` are PROVENANCE, not decoration: every field below was read from that
 * page on that date, and `driftReport()` exists because a page read months ago is a claim, not a
 * fact. Pricing is the vendor's own and is recorded as a claim with its date, never as a current
 * quote.
 */
const CONNECTORS = Object.freeze([
  Object.freeze({
    id: 'kite',
    label: 'Zerodha Kite Connect',
    docsUrl: 'https://kite.trade/docs/connect/v3/',
    docsCheckedAt: '2026-10-09',
    dataOnly: true,
    // VENDOR claim, dated. Not a quote and not re-verified at use time.
    costNote: 'vendor-stated 500 INR per month per app for the data subscription (checked 2026-10-09)',
    splitNote: 'Kite Connect is one key; the data subscription is an add-on to it, not a separate key.',
    fields: Object.freeze([
      Object.freeze({ key: 'baseUrl', kind: 'url', label: 'API base URL', secret: false,
        declared: 'https://api.kite.trade' }),
      Object.freeze({ key: 'apiKey', kind: 'text', label: 'API key', secret: false }),
      Object.freeze({ key: 'apiSecret', kind: 'secret', label: 'API secret', secret: true }),
      Object.freeze({ key: 'accessToken', kind: 'secret', label: 'Access token (per session)', secret: true }),
    ]),
    // Only read paths. Anything that could place an order is absent BY DECLARATION.
    paths: Object.freeze(['/quote', '/quote/ohlc', '/quote/ltp', '/instruments', '/historical']),
  }),
  Object.freeze({
    id: 'dhan',
    label: 'DhanHQ Data API',
    docsUrl: 'https://dhanhq.co/docs/v2/',
    docsCheckedAt: '2026-10-09',
    dataOnly: true,
    costNote: 'vendor-stated 499 INR plus taxes per month for the Data API (checked 2026-10-09)',
    // THE REASON THIS CONNECTOR IS PREFERRED: the narrower credential is actually available.
    splitNote: 'Dhan issues the Data API separately from the trading API, so a DATA-ONLY token is '
      + 'possible. Prefer it: a key that cannot place an order is better than a promise not to.',
    fields: Object.freeze([
      Object.freeze({ key: 'baseUrl', kind: 'url', label: 'API base URL', secret: false,
        declared: 'https://api.dhan.co' }),
      Object.freeze({ key: 'clientId', kind: 'text', label: 'Client ID', secret: false }),
      Object.freeze({ key: 'accessToken', kind: 'secret', label: 'Data API access token', secret: true }),
    ]),
    paths: Object.freeze(['/marketfeed/ltp', '/marketfeed/quote', '/marketfeed/depth',
      '/charts/historical', '/instruments']),
  }),
  Object.freeze({
    id: 'upstox',
    label: 'Upstox API',
    docsUrl: 'https://upstox.com/developer/api-documentation/',
    docsCheckedAt: '2026-10-09',
    dataOnly: true,
    costNote: 'vendor-stated as free for API access (checked 2026-10-09); market-data entitlement '
      + 'terms NOT verified',
    splitNote: 'No separate data-only key is recorded. Treat as a full-access credential until '
      + 'verified otherwise.',
    fields: Object.freeze([
      Object.freeze({ key: 'baseUrl', kind: 'url', label: 'API base URL', secret: false,
        declared: 'https://api.upstox.com' }),
      Object.freeze({ key: 'apiKey', kind: 'text', label: 'API key', secret: false }),
      Object.freeze({ key: 'apiSecret', kind: 'secret', label: 'API secret', secret: true }),
      Object.freeze({ key: 'accessToken', kind: 'secret', label: 'Access token', secret: true }),
    ]),
    paths: Object.freeze(['/market-quote/quotes', '/historical-candle', '/instruments']),
  }),
]);

const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : '');

/** @returns {object|null} the declared connector, or null. */
function connector(id) {
  const key = text(id).toLowerCase();
  return CONNECTORS.find((c) => c.id === key) || null;
}

/** Every declared id, for a chooser. */
function ids() {
  return CONNECTORS.map((c) => c.id);
}

/**
 * The form master fills in — "the fields to actually add URLs and creds".
 *
 * Returns a DESCRIPTION. No value, no secret, nothing read from the vault: a renderer gets what to
 * ask for and `credentialVault` keeps what was answered.
 *
 * @returns {{ok: boolean, id?: string, label?: string, docsUrl?: string, docsCheckedAt?: string,
 *   dataOnly?: boolean, costNote?: string, splitNote?: string, fields?: Array<object>, error?: string}}
 */
function fieldsFor(id) {
  const c = connector(id);
  if (!c) return { ok: false, error: `no connector is declared for ${JSON.stringify(id)}.` };
  return {
    ok: true,
    id: c.id,
    label: c.label,
    // CARRIED TO THE FORM DELIBERATELY: master should be able to see WHICH page these fields came
    // from and WHEN, beside the boxes he is about to paste a credential into.
    docsUrl: c.docsUrl,
    docsCheckedAt: c.docsCheckedAt,
    dataOnly: c.dataOnly,
    costNote: c.costNote,
    splitNote: c.splitNote,
    fields: c.fields.map((f) => ({
      key: f.key,
      kind: f.kind,
      label: f.label,
      secret: f.secret === true,
      // A suggested default, never a stored value.
      suggested: f.declared || null,
    })),
  };
}

/** Does any declared path look like an order path? Used as a self-check, not as a filter. */
function declaresOrderPath(c) {
  if (!c || !Array.isArray(c.paths)) return false;
  return c.paths.some((p) => ORDER_PATH.test(String(p)));
}

/**
 * Compare a DECLARED connector against the text of its own documentation.
 *
 * PURE: it takes the fetched text rather than fetching, so it is testable against a fixture and the
 * network is somebody else's problem. The caller fetches (Rama already has a web path) and hands the
 * text in.
 *
 * WHAT IT REPORTS, and what it refuses to do:
 *   - `missingFields` — a declared field name that no longer appears in the docs. **The most
 *     important finding, because that is the box master would be filling in for a parameter the
 *     broker has removed.**
 *   - `missingPaths` — a declared endpoint absent from the docs.
 *   - `orderPathsSeen` — order-placement paths present in the DOCS. Expected and harmless, recorded
 *     only so a reader can see the connector stayed on the read-only subset while the API offers
 *     more.
 *   - It NEVER returns a rewritten connector. There is no auto-apply, by design (I6/I17).
 *
 * An absent or too-short document is `inconclusive`, never "all clear" — a failed fetch that reads as
 * agreement is the quiet failure this whole function exists to avoid.
 *
 * @param {string} id
 * @param {string} docText
 * @returns {object}
 */
function driftReport(id, docText) {
  const c = connector(id);
  if (!c) return { ok: false, error: `no connector is declared for ${JSON.stringify(id)}.` };

  const body = typeof docText === 'string' ? docText : '';
  // A trivially short body is a failed fetch, a login wall or a redirect — not a document.
  if (body.trim().length < 200) {
    return {
      ok: true,
      id: c.id,
      inconclusive: true,
      reason: `the fetched document is ${body.trim().length} characters, which is too short to `
        + 'verify anything against. This is NOT agreement — treat the declaration as unchecked.',
      checkedAt: null,
      missingFields: [],
      missingPaths: [],
      orderPathsSeen: [],
      proposal: null,
    };
  }

  const hay = body.toLowerCase();
  const missingFields = c.fields
    .filter((f) => f.key !== 'baseUrl')
    .filter((f) => !hay.includes(f.key.toLowerCase()))
    .map((f) => f.key);
  const missingPaths = c.paths.filter((p) => !hay.includes(String(p).toLowerCase()));

  // Order paths the DOCS mention. Informational: it shows the API is wider than the connector.
  const orderPathsSeen = (body.match(/\/[a-z0-9/_-]{2,40}/gi) || [])
    .filter((p) => ORDER_PATH.test(p))
    .map((p) => p.toLowerCase())
    .filter((p, i, a) => a.indexOf(p) === i)
    .slice(0, 20);

  const drifted = missingFields.length > 0 || missingPaths.length > 0;

  return {
    ok: true,
    id: c.id,
    inconclusive: false,
    docsUrl: c.docsUrl,
    declaredAt: c.docsCheckedAt,
    drifted,
    missingFields,
    missingPaths,
    orderPathsSeen,
    // A PROPOSAL, in words, for master. Not a patch, not an edit, not a write.
    proposal: drifted
      ? `${c.label}'s documentation no longer mentions `
        + `${[...missingFields, ...missingPaths].join(', ')}. Re-read ${c.docsUrl} and update the `
        + 'declaration in electron/lib/brokerConnectors.cjs before entering or reusing a credential '
        + 'for it. Nothing has been changed automatically.'
      : null,
    note: drifted
      ? 'declared structure and documentation DISAGREE'
      : 'every declared field and path still appears in the documentation',
  };
}

module.exports = {
  CONNECTORS, ORDER_PATH, FIELD_KINDS,
  connector, ids, fieldsFor, declaresOrderPath, driftReport,
};
