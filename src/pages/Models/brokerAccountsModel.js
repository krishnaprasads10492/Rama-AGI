/**
 * brokerAccountsModel.js - what the broker-account panel says, as data (spec Section 152)
 *
 * The panel handles the part of Rāma that is nearest to money, so its sentences are made here, from the main
 * process's answer, and driven by `scripts/verifyBrokerAccountsUi.mjs`. The rules it holds:
 *   - A SECRET IS NEVER A STRING IN THIS MODULE. The main process sends `hasSecret`; that is all there is.
 *   - A detected IP is a fact about THIS machine only. For any other distributable it is never compared.
 *   - Rāma places no orders. Whitelisting matters only to order APIs, and the panel says so beside the form.
 */

export const REASON = {
  title: 'Why each distributable has its own IP',
  lines: [
    'From 1 April 2026 a broker API order must come from a static IP registered with the broker. Zerodha takes one primary IP, an optional secondary, and allows one change per calendar week.',
    'Registering an IP is a declaration that only you and your immediate family use it. A distributable runs on someone else\'s machine and network, so it cannot share yours.',
    'Reading prices, positions and the order book works from any IP. Rāma places no orders, so for Rāma today this is a record, not a requirement. Keep it accurate anyway: a wrong entry costs a week to correct.',
  ],
};

const clean = (v) => (typeof v === 'string' ? v.trim() : '');

/** What master should read beside an account's IPs. */
export function ipStatus(acct) {
  const a = acct || {};
  const regs = [a.primaryIp, a.secondaryIp].filter(Boolean);
  switch (a.ipState) {
    case 'match':
      return { tone: 'good', label: 'MATCHES THIS MACHINE', text: `This machine's address (${a.detectedIp}) is one of the registered IPs.` };
    case 'mismatch':
      return {
        tone: 'bad', label: 'DOES NOT MATCH',
        text: `This machine reports ${a.detectedIp}, which is not registered (${regs.join(', ')}). Calls that need a whitelisted IP would be refused from here. Changing the registered IP is limited to once a week.`,
      };
    case 'not-checked':
      return { tone: 'muted', label: 'NOT CHECKED', text: 'Press "Detect this machine\'s IP" to compare it with the registered ones.' };
    case 'other-machine':
      return { tone: 'muted', label: 'OTHER MACHINE', text: 'This account belongs to a distributable that runs elsewhere, so this machine\'s address says nothing about it.' };
    case 'registered':
      return { tone: 'muted', label: 'REGISTERED', text: regs.join(', ') };
    default:
      return { tone: 'muted', label: 'NO IP', text: 'No IP is registered for this account.' };
  }
}

/** The weekly-change sentence, or null when a change is allowed now. */
export function changeLock(acct) {
  const on = acct && acct.nextIpChangeOn;
  return on ? `The registered IPs were changed recently. Zerodha allows one change a week; the next is allowed from ${on}.` : null;
}

/** Group accounts by distributable, so the screen shows each distributable beside its own IPs. */
export function groupByDistributable(snapshot) {
  const dists = (snapshot && snapshot.distributables) || [];
  const accts = (snapshot && snapshot.accounts) || [];
  return dists.map((d) => ({
    ...d,
    accounts: accts.filter((a) => a.distributableId === d.id),
    sentence: d.ips && d.ips.length
      ? `${d.ips.length} registered ${d.ips.length === 1 ? 'IP' : 'IPs'}: ${d.ips.join(', ')}`
      : 'No IP registered yet.',
  }));
}

/** A one-line check of a draft before it is sent, so an obvious mistake never spends a round trip. */
export function draftProblems(d) {
  const draft = d || {};
  const out = [];
  if (!clean(draft.label)) out.push('Give the account a label.');
  if (!draft.id && !clean(draft.apiKey)) out.push('The API key is required.');
  if (!draft.id && !clean(draft.secret)) out.push('The API secret is required for a new account.');
  if (clean(draft.secondaryIp) && !clean(draft.primaryIp)) out.push('A secondary IP needs a primary IP.');
  if (clean(draft.primaryIp) && clean(draft.primaryIp) === clean(draft.secondaryIp)) out.push('The primary and secondary IP are the same.');
  return out;
}

/** The empty form. The secret field is always empty: it is never filled from anything. */
export function blankDraft(distributableId) {
  return {
    id: '', label: '', brokerId: 'kite', clientId: '', apiKey: '', secret: '', primaryIp: '', secondaryIp: '',
    distributableId: distributableId || '', sharedWithFamily: false, notes: '', acknowledgeWeeklyLimit: false,
  };
}

/** Editing an account starts from the view, which has no secret, so the secret box starts empty by construction. */
export function draftFrom(view) {
  return {
    ...blankDraft(view.distributableId),
    id: view.id, label: view.label, brokerId: view.brokerId, clientId: view.clientId || '',
    apiKey: '', primaryIp: view.primaryIp || '', secondaryIp: view.secondaryIp || '',
    sharedWithFamily: !!view.sharedWithFamily, notes: view.notes || '',
  };
}

/** Is this refusal the weekly lock, which the form answers with a confirmation rather than an error? */
export function isWeeklyLock(res) {
  return !!(res && res.needsAcknowledgement === true);
}

/** Who may see the panel at all. Mirrors the main process; the main process is the real gate. */
export function visibleTo(can, user) {
  return typeof can === 'function' && can(user, 'brokers.accounts.view') === true;
}

export function mayWrite(can, user) {
  return typeof can === 'function' && can(user, 'brokers.accounts.write') === true;
}
