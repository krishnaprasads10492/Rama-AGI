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

// ─── Kite Connect as a data source (Section 156) ─────────────────────────────────────────────────

export const KITE_REDIRECT_NOTE = 'In your Kite app\'s settings the redirect URL can be any address you own, for example http://127.0.0.1/ . Nothing has to be running there: Rāma reads the address from your browser\'s address bar after you log in. If Kite will not accept that address, use one it does accept.';

export const KITE_PREREQ = 'Kite Connect needs TOTP two-factor sign-in turned on for the Zerodha account. A session also ends if you log in to Kite somewhere else.';

export const KITE_STEPS = [
  'Press OPEN KITE LOGIN. Your browser opens Zerodha\'s own login page; Rāma never sees your password.',
  'Log in. Kite then sends the browser to your redirect address, which may show an error page. That is fine.',
  'Copy the full address from the address bar, paste it below, and press COMPLETE LOGIN.',
];

/** One account's Kite session as a sentence and a tone. */
export function sessionStatus(acct) {
  const s = (acct && acct.session) || { state: 'none' };
  if (s.state === 'live') {
    const until = s.expiresAt ? String(s.expiresAt).replace('T', ' ').slice(0, 16) : 'tomorrow 06:00 IST';
    return { state: 'live', tone: 'good', label: 'LOGGED IN', text: `Logged in${s.userId ? ` as ${s.userId}` : ''}. The session ends at 6 AM IST (${until} UTC) and then needs a new login.` };
  }
  if (s.state === 'expired') return { state: 'expired', tone: 'bad', label: 'SESSION ENDED', text: 'The Kite session ended (they last until 6 AM IST). Log in again to fetch candles.' };
  return { state: 'none', tone: 'muted', label: 'NOT LOGGED IN', text: 'Not logged in to Kite. Candles can be fetched only while a session is live.' };
}

/** Only Zerodha accounts have a Kite session. */
export const isKite = (acct) => !!acct && acct.brokerId === 'kite';

const KITE_INTERVALS = ['1m', '3m', '5m', '10m', '15m', '30m', '60m', '1h', '1d'];
export const kiteSupportsInterval = (interval) => KITE_INTERVALS.includes(String(interval || '').toLowerCase());

/** The first Kite account with a live session, or the first Kite account at all, or null. */
export function pickKiteAccount(snapshot) {
  const list = ((snapshot && snapshot.accounts) || []).filter(isKite);
  return list.find((a) => a.session && a.session.state === 'live') || list[0] || null;
}

/** Why the Kite fetch button cannot be pressed, as one sentence; null when it can. */
export function whyCannotKiteFetch({ account, symbol, interval, busy }) {
  if (!account) return 'No Zerodha account is registered.';
  if (!symbol) return 'Pick an instrument first.';
  if (!kiteSupportsInterval(interval)) return `Kite has no ${interval} candles (use 1m, 5m, 15m, 30m, 60m or 1d).`;
  if (!account.session || account.session.state !== 'live') return 'Log in to Kite first (Models > Brokers). Sessions end at 6 AM IST.';
  if (busy) return 'A Kite fetch is running.';
  return null;
}

/** What to say after a fetch. Never includes a token; the reply has none. */
export function kiteFetchMessage(res) {
  if (!res) return 'No answer from Kite.';
  if (res.ok === false) return res.error || 'Kite fetch failed.';
  const st = res.stored || {};
  const range = st.firstBar && st.lastBar ? ` The store now holds ${st.bars} bars, ${String(st.firstBar).slice(0, 10)} to ${String(st.lastBar).slice(0, 10)}.` : '';
  const partial = res.partial ? ` Stopped early: ${res.partial}` : '';
  const skipped = res.skipped ? ` ${res.skipped} malformed candles were ignored.` : '';
  return `Kite sent ${res.fetched} candles in ${res.requests} ${res.requests === 1 ? 'request' : 'requests'} and they were kept for analysis.${range}${skipped}${partial}`;
}
