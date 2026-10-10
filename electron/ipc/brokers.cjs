'use strict';

/**
 * brokers.cjs — the read channel for the declared broker data connectors (spec Section 145).
 *
 * WHY THIS FILE EXISTS. `electron/lib/brokerConnectors.cjs` was built in Section 141 with 81
 * assertions and **no channel, no preload namespace and no page** — the module audit's H7. Three
 * declared connectors, a credential form description and a drift reporter, all correct and all
 * unreachable. A contract with no producer, the seventh found.
 *
 * WHAT IT DELIBERATELY DOES NOT DO:
 *
 *   IT NEVER APPLIES A DRIFT REPORT. `driftReport()` returns findings and writes nothing; this
 *   channel returns those findings to master and stops. I6 and I17 say Rāma does not rewrite its own
 *   source, and a connector silently re-shaped from a page that could have changed for any reason is
 *   a credential pointed somewhere new. Declare, verify, PROPOSE.
 *
 *   IT NEVER FETCHES ON ITS OWN. `driftReport` is pure and takes the document text, so the caller
 *   supplies it. That keeps the network out of a function that has to be testable against a fixture,
 *   and it means this channel cannot be turned into an outbound request by a crafted argument.
 *
 *   IT CARRIES NO CREDENTIAL. `fieldsFor()` returns a form DESCRIPTION — which fields a broker needs,
 *   which are secret, which may suggest a default. The values belong to `credentialVault.cjs`. This
 *   channel is asserted to return no field carrying a `value`, `token` or `secretValue`.
 *
 * GATED ON `vault.read`, not on a weaker capability: the fields describe what master is about to
 * paste a credential into, and the connector list says which brokers Rāma can hold keys for. That is
 * the same sensitivity class as reading the vault's own contents list.
 */

const brokers = require('../lib/brokerConnectors.cjs');
const capability = require('../lib/capability.cjs');

/** A document under this length is a login wall, a redirect or an outage — never an all-clear. */
const MIN_DOC_CHARS = 200;

function register(ipcMain) {
  /** The declared connectors, with their provenance. No secrets, no credential values. */
  ipcMain.handle('brokers:list', async (_e, { user } = {}) => {
    const denied = capability.deny(user, 'vault.read');
    if (denied) return denied;
    return {
      ok: true,
      data: brokers.ids().map((id) => {
        const c = brokers.connector(id);
        return {
          id,
          label: c.label,
          dataOnly: c.dataOnly === true,
          docsUrl: c.docsUrl,
          docsCheckedAt: c.docsCheckedAt,
          pricing: c.pricing ?? null,
          // STATED POSITIVELY so a reader does not have to infer it from an absence: every connector
          // declares no order path, and the suite in Section 141 fails if one ever does.
          declaresOrderPath: brokers.declaresOrderPath(c),
        };
      }),
      note: 'Rāma never places an order. These connectors are declared DATA ONLY, and the '
        + 'verification suite fails if any of them ever declares an order, trade or GTT path.',
    };
  });

  /** The credential form for one broker: which fields, which are secret, where they came from. */
  ipcMain.handle('brokers:fields', async (_e, { user, id } = {}) => {
    const denied = capability.deny(user, 'vault.read');
    if (denied) return denied;
    const form = brokers.fieldsFor(id);
    // `fieldsFor` refuses an unknown id itself; the refusal is passed through rather than reworded,
    // so there is one sentence for one fact.
    if (!form || form.ok === false) return form || { ok: false, error: 'unknown broker id' };
    return form;
  });

  /**
   * Compare a fetched documentation page against the DECLARED fields and report drift.
   *
   * The caller supplies `docText`. A short body is `inconclusive` and never all-clear — a login wall
   * reading as "every field still present" is the exact quiet failure the function exists to prevent,
   * and that check is repeated here so a caller cannot reach `driftReport` with a stub page.
   */
  ipcMain.handle('brokers:drift-check', async (_e, { user, id, docText } = {}) => {
    const denied = capability.deny(user, 'vault.read');
    if (denied) return denied;
    if (typeof docText !== 'string' || docText.trim().length < MIN_DOC_CHARS) {
      return {
        ok: false,
        inconclusive: true,
        error: `the supplied document is under ${MIN_DOC_CHARS} characters, so it cannot be compared. `
          + 'A login wall, a redirect or an outage must not read as "nothing has drifted".',
      };
    }
    const report = brokers.driftReport(id, docText);
    return {
      ...report,
      // SAID AT THE CHANNEL, not only in the module. Master sees this response; he does not read
      // `brokerConnectors.cjs` to learn that nothing was applied.
      applied: false,
      appliedNote: 'Nothing has been changed automatically. This is a report for you to act on.',
    };
  });
}

module.exports = { register, MIN_DOC_CHARS };
