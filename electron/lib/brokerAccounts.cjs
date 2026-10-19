'use strict';

/**
 * brokerAccounts.cjs - several broker API accounts and the static IP each is registered under (spec Section 152)
 *
 * WHY THIS EXISTS, FROM ZERODHA'S OWN PAGE (checked 2026-10-17): from 1 April 2026 an API-based ORDER needs a
 * static IP registered on the developer account. One primary IP is required, a secondary is optional, two at
 * most; exchange rules allow ONE CHANGE PER CALENDAR WEEK; and saving an IP declares it is used only by the
 * account holder and immediate family. Read APIs (quotes, the websocket, orderbook, positions) work from any IP.
 * Rāma places no orders (Section 95), so this registry is bookkeeping: it is wrong-proofing, because a mistake
 * here costs a week.
 *
 * WHY EACH DISTRIBUTABLE HAS ITS OWN IP: a distributable runs on someone else's machine and network. Master's
 * IP on it would break the family declaration, and an installer cannot know the network it will land on.
 *
 * WHAT THIS MODULE IS: pure rules and a store-shaped persistence, no Electron, no network, so every rule here is
 * driven by `scripts/verifyBrokerAccounts.cjs`. The store is injected ({get, set}); production passes dataStore.
 *
 * SECRETS: the API secret is accepted, stored, and NEVER returned. `view()` is the only way an account leaves
 * this module and it has no secret in it. There is no reveal function, on purpose.
 */

const net = require('net');
const crypto = require('crypto');
const kite = require('./kiteClient.cjs');

const DOMAIN = 'brokerAccounts';
const MAX_ACCOUNTS = 40;
const MAX_DISTRIBUTABLES = 40;
const WEEK_MS = 7 * 24 * 3600 * 1000;
const MIN_SECRET = 16;

const text = (v) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '').trim() : '');

// ─── IP rules ────────────────────────────────────────────────────────────────────────────────────

/** [network, prefix] pairs that cannot be reached from Zerodha's side, so cannot be whitelisted. */
const V4_NOT_PUBLIC = [
  ['0.0.0.0', 8, 'this-network'], ['10.0.0.0', 8, 'private'], ['100.64.0.0', 10, 'carrier-grade NAT'],
  ['127.0.0.0', 8, 'loopback'], ['169.254.0.0', 16, 'link-local'], ['172.16.0.0', 12, 'private'],
  ['192.0.0.0', 24, 'reserved'], ['192.0.2.0', 24, 'documentation'], ['192.168.0.0', 16, 'private'],
  ['198.18.0.0', 15, 'benchmarking'], ['198.51.100.0', 24, 'documentation'], ['203.0.113.0', 24, 'documentation'],
  ['224.0.0.0', 4, 'multicast'], ['240.0.0.0', 4, 'reserved'],
];

const v4ToInt = (s) => s.split('.').reduce((a, o) => ((a << 8) + Number(o)) >>> 0, 0);

function inV4(ipInt, net_, prefix) {
  const base = v4ToInt(net_);
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return ((ipInt & mask) >>> 0) === ((base & mask) >>> 0);
}

/** Strict dotted quad: four decimal octets, no leading zeros (01.2.3.4 is read differently by different tools). */
function strictV4(s) {
  if (!net.isIPv4(s)) return false;
  return s.split('.').every((o) => o === '0' || !/^0/.test(o));
}

/** Eight 16-bit groups from an IPv6 string, or null. Zone ids (%eth0) are refused: they are local, not routable. */
function v6Groups(s) {
  if (!net.isIPv6(s) || s.includes('%')) return null;
  let str = s.toLowerCase();
  const tail = str.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (tail) {
    if (!strictV4(tail[1])) return null;
    const n = v4ToInt(tail[1]);
    str = str.slice(0, -tail[1].length) + ((n >>> 16).toString(16)) + ':' + ((n & 0xffff).toString(16));
  }
  const [head, rest] = str.split('::');
  const a = head ? head.split(':') : [];
  const b = rest !== undefined && rest ? rest.split(':') : [];
  if (rest === undefined && a.length !== 8) return null;
  const fill = 8 - a.length - b.length;
  if (rest !== undefined && fill < 1 && !(fill === 0 && (a.length + b.length) === 8)) return null;
  const all = rest === undefined ? a : [...a, ...Array(Math.max(0, fill)).fill('0'), ...b];
  if (all.length !== 8) return null;
  const g = all.map((x) => parseInt(x, 16));
  return g.some((x) => !Number.isInteger(x) || x < 0 || x > 0xffff) ? null : g;
}

/**
 * Is this string an IP Zerodha could whitelist?
 * @returns {{ok:boolean, ip?:string, version?:4|6, reason?:string}} `ip` is the CANONICAL form, so two spellings
 *   of one address compare equal.
 */
function classifyIp(input) {
  const s = text(input);
  if (!s) return { ok: false, reason: 'an IP address is required' };
  if (s.length > 45) return { ok: false, reason: 'that is too long to be an IP address' };
  if (s.includes('/')) return { ok: false, reason: 'enter one address, not a range (Zerodha takes single IPs)' };
  if (net.isIPv4(s)) {
    if (!strictV4(s)) return { ok: false, reason: 'IPv4 octets must be plain decimals without leading zeros' };
    const n = v4ToInt(s);
    for (const [base, prefix, why] of V4_NOT_PUBLIC) {
      if (inV4(n, base, prefix)) return { ok: false, reason: `${s} is a ${why} address; Zerodha cannot reach it, so it cannot be whitelisted` };
    }
    if (n === 0xffffffff) return { ok: false, reason: `${s} is the broadcast address` };
    return { ok: true, ip: s, version: 4 };
  }
  const g = v6Groups(s);
  if (!g) return { ok: false, reason: `${s} is not a valid IP address` };
  const canon = g.map((x) => x.toString(16)).join(':');
  const isZero = g.every((x) => x === 0);
  if (isZero) return { ok: false, reason: 'the unspecified address cannot be whitelisted' };
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return { ok: false, reason: 'the loopback address cannot be whitelisted' };
  if ((g[0] & 0xffc0) === 0xfe80) return { ok: false, reason: 'a link-local IPv6 address cannot be whitelisted' };
  if ((g[0] & 0xfe00) === 0xfc00) return { ok: false, reason: 'a unique-local IPv6 address is private and cannot be whitelisted' };
  if ((g[0] & 0xff00) === 0xff00) return { ok: false, reason: 'a multicast address cannot be whitelisted' };
  if (g[0] === 0x2001 && g[1] === 0x0db8) return { ok: false, reason: 'that range is reserved for documentation' };
  // An IPv4-mapped address is judged as the IPv4 it wraps: ::ffff:10.0.0.1 is still private.
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) {
    const v4 = `${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`;
    const inner = classifyIp(v4);
    return inner.ok ? { ok: true, ip: v4, version: 4 } : inner;
  }
  return { ok: true, ip: canon, version: 6 };
}

/**
 * The IPs on an account, validated together: primary required once a secondary exists, at most two, no
 * duplicates between them.
 * @returns {{ok:boolean, primary?:string|null, secondary?:string|null, errors?:string[]}}
 */
function normaliseIps(primaryRaw, secondaryRaw) {
  const errors = [];
  const hasP = text(primaryRaw) !== '';
  const hasS = text(secondaryRaw) !== '';
  let primary = null;
  let secondary = null;
  if (hasP) {
    const c = classifyIp(primaryRaw);
    if (c.ok) primary = c.ip; else errors.push(`Primary IP: ${c.reason}`);
  }
  if (hasS) {
    const c = classifyIp(secondaryRaw);
    if (c.ok) secondary = c.ip; else errors.push(`Secondary IP: ${c.reason}`);
  }
  if (hasS && !hasP) errors.push('A secondary IP needs a primary IP: Zerodha requires the primary.');
  if (primary && secondary && primary === secondary) errors.push('The primary and secondary IP are the same address.');
  return errors.length ? { ok: false, errors } : { ok: true, primary, secondary };
}

const sameIpSet = (a, b) => {
  const s = (o) => [o.primaryIp || null, o.secondaryIp || null].filter(Boolean).sort().join('|');
  return s(a) === s(b);
};

/**
 * Zerodha allows ONE IP change per calendar week. Changing the registered set inside that week is refused
 * unless the caller says they have already done it at Zerodha or accept the lock (`acknowledged`): the registry
 * must be able to record what is TRUE there, but it must never let a plan quietly outrun the rule.
 * The window is a rolling 7 days: stricter than a calendar week, so it can only err toward caution.
 */
function checkIpChange(prev, next, now = Date.now(), acknowledged = false) {
  if (!prev || (!prev.primaryIp && !prev.secondaryIp)) return { ok: true, firstSet: true };
  if (sameIpSet(prev, next)) return { ok: true, unchanged: true };
  const at = Date.parse(prev.ipChangedAt || '');
  if (!Number.isFinite(at)) return { ok: true, unknownLast: true };
  const clears = at + WEEK_MS;
  if (now >= clears) return { ok: true };
  if (acknowledged) return { ok: true, acknowledgedLock: true };
  return {
    ok: false, needsAcknowledgement: true, clearsOn: new Date(clears).toISOString().slice(0, 10),
    error: `The registered IPs were changed on ${new Date(at).toISOString().slice(0, 10)}. Zerodha allows one change `
      + `per calendar week, so the next is allowed from ${new Date(clears).toISOString().slice(0, 10)}. `
      + 'If you have already changed them at Zerodha and are recording that, confirm it.',
  };
}

/**
 * An IP already registered to a DIFFERENT distributable is refused unless the account carries the explicit
 * family declaration. Zerodha's declaration is that an IP is used only by the holder and immediate family; two
 * distributables on one IP is what it forbids unless they are the same household.
 */
function checkIpConflicts(accounts, candidate) {
  const mine = [candidate.primaryIp, candidate.secondaryIp].filter(Boolean);
  if (!mine.length) return { ok: true };
  for (const a of accounts) {
    if (a.id === candidate.id || a.distributableId === candidate.distributableId) continue;
    const theirs = [a.primaryIp, a.secondaryIp].filter(Boolean);
    const shared = mine.filter((ip) => theirs.includes(ip));
    if (shared.length && !(candidate.sharedWithFamily === true && a.sharedWithFamily === true)) {
      return {
        ok: false, conflictWith: a.id, ip: shared[0],
        error: `${shared[0]} is already registered to another distributable (account "${a.label}"). Each distributable `
          + 'needs its own IP: Zerodha takes the IP as a declaration that it is used only by you and your immediate '
          + 'family. If both belong to one household, mark BOTH accounts as shared with family.',
      };
    }
  }
  return { ok: true };
}

// ─── Fields ──────────────────────────────────────────────────────────────────────────────────────

const maskKey = (k) => {
  const s = text(k);
  if (!s) return '';
  return s.length <= 4 ? '•'.repeat(s.length) : `${s.slice(0, 4)}${'•'.repeat(Math.min(12, s.length - 4))}`;
};

const newId = (prefix) => `${prefix}_${crypto.randomBytes(6).toString('hex')}`;

/** Validate one account submission. The key and the secret are optional ON UPDATE (blank keeps the stored one). */
function validateAccount(input, { isNew, brokerIds }) {
  const errors = [];
  const o = input && typeof input === 'object' ? input : {};
  const label = text(o.label).slice(0, 60);
  if (!label) errors.push('Give the account a label.');
  const brokerId = text(o.brokerId).toLowerCase() || 'kite';
  if (brokerIds && !brokerIds.includes(brokerId)) errors.push(`Unknown broker "${brokerId}".`);
  const clientId = text(o.clientId).toUpperCase();
  if (clientId && !/^[A-Z0-9]{3,16}$/.test(clientId)) errors.push('The client ID should be letters and digits only (for example AB1234).');
  const apiKey = text(o.apiKey);
  if (!apiKey) { if (isNew) errors.push('The API key is required.'); }
  else if (!/^[A-Za-z0-9_-]{6,64}$/.test(apiKey)) errors.push('The API key should be 6 to 64 letters, digits, hyphens or underscores.');
  const secretRaw = typeof o.secret === 'string' ? o.secret.trim() : '';
  if (secretRaw) {
    if (secretRaw.length < MIN_SECRET) errors.push(`The API secret looks too short (under ${MIN_SECRET} characters); check it was pasted whole.`);
    else if (/\s/.test(secretRaw)) errors.push('The API secret contains whitespace; check it was pasted whole.');
    else if (secretRaw.length > 256) errors.push('The API secret is too long.');
  } else if (isNew) errors.push('The API secret is required for a new account.');
  const ips = normaliseIps(o.primaryIp, o.secondaryIp);
  if (!ips.ok) errors.push(...ips.errors);
  return {
    ok: errors.length === 0, errors,
    clean: {
      label, brokerId, clientId, apiKey,
      secret: secretRaw || null,
      primaryIp: ips.ok ? ips.primary : null, secondaryIp: ips.ok ? ips.secondary : null,
      distributableId: text(o.distributableId) || null,
      sharedWithFamily: o.sharedWithFamily === true,
      notes: text(o.notes).slice(0, 200),
      acknowledgeWeeklyLimit: o.acknowledgeWeeklyLimit === true,
    },
  };
}

// ─── Persistence ─────────────────────────────────────────────────────────────────────────────────

function read(store) {
  const accounts = store.get(DOMAIN, 'accounts');
  const distributables = store.get(DOMAIN, 'distributables');
  const settings = store.get(DOMAIN, 'settings');
  return {
    accounts: Array.isArray(accounts) ? accounts : [],
    distributables: Array.isArray(distributables) ? distributables : [],
    settings: settings && typeof settings === 'object' ? settings : {},
  };
}

/** The installation is always one distributable; its id is the install's own instance id. */
function selfDistributable(self) {
  return { id: self.id, label: self.label || 'This installation', self: true, createdAt: self.createdAt || null, notes: '' };
}

function allDistributables(store, self) {
  const { distributables } = read(store);
  return [selfDistributable(self), ...distributables.filter((d) => d.id !== self.id)];
}

/**
 * The only shape that leaves this module. No secret, ever; the key is masked; the next allowed IP change date
 * is computed; and the registered IPs are compared with what was detected, but only for the distributable that
 * IS this machine (a detected address says nothing about another machine).
 */
function view(account, ctx = {}) {
  const now = ctx.now || Date.now();
  const self = ctx.selfId && account.distributableId === ctx.selfId;
  const registered = [account.primaryIp, account.secondaryIp].filter(Boolean);
  let ipState = 'none';
  if (registered.length) ipState = 'registered';
  const detected = ctx.detected && ctx.detected.ip ? ctx.detected.ip : null;
  if (registered.length && self) {
    if (!detected) ipState = 'not-checked';
    else ipState = registered.includes(detected) ? 'match' : 'mismatch';
  } else if (registered.length && !self) ipState = 'other-machine';
  const at = Date.parse(account.ipChangedAt || '');
  const clears = Number.isFinite(at) ? at + WEEK_MS : null;
  return {
    id: account.id, brokerId: account.brokerId, label: account.label, clientId: account.clientId || '',
    apiKeyMasked: maskKey(account.apiKey), hasSecret: !!account.secret,
    distributableId: account.distributableId, primaryIp: account.primaryIp || '', secondaryIp: account.secondaryIp || '',
    ipChangedAt: account.ipChangedAt || null,
    nextIpChangeOn: clears && clears > now ? new Date(clears).toISOString().slice(0, 10) : null,
    sharedWithFamily: account.sharedWithFamily === true, notes: account.notes || '',
    createdAt: account.createdAt || null, updatedAt: account.updatedAt || null,
    ipState, detectedIp: self ? detected : null,
    // The token itself never leaves: state, who, and when it dies (Section 156).
    session: sessionView(account, now),
  };
}

function sessionView(account, now) {
  const s = account.session;
  if (!s || !s.accessToken) return { state: 'none', userId: null, userName: null, issuedAt: null, expiresAt: null };
  return {
    state: kite.sessionState(s, now), userId: s.userId || null, userName: s.userName || null,
    issuedAt: Number.isFinite(s.issuedAt) ? new Date(s.issuedAt).toISOString() : null,
    expiresAt: Number.isFinite(s.issuedAt) ? new Date(kite.tokenExpiry(s.issuedAt)).toISOString() : null,
  };
}

function snapshot(store, ctx) {
  const { accounts, settings } = read(store);
  const dists = allDistributables(store, ctx.self);
  return {
    accounts: accounts.map((a) => view(a, { selfId: ctx.self.id, detected: settings.detected, now: ctx.now })),
    distributables: dists.map((d) => {
      const own = accounts.filter((a) => a.distributableId === d.id);
      return { ...d, accountCount: own.length, ips: [...new Set(own.flatMap((a) => [a.primaryIp, a.secondaryIp].filter(Boolean)))] };
    }),
    detected: settings.detected || null,
    self: { id: ctx.self.id, label: ctx.self.label || 'This installation' },
    limits: { maxAccounts: MAX_ACCOUNTS, maxDistributables: MAX_DISTRIBUTABLES, minSecret: MIN_SECRET, weekDays: 7 },
  };
}

function saveAccount(store, input, ctx) {
  const { accounts } = read(store);
  const id = text(input && input.id);
  const existing = id ? accounts.find((a) => a.id === id) : null;
  if (id && !existing) return { ok: false, error: 'That account no longer exists.' };
  if (!existing && accounts.length >= MAX_ACCOUNTS) return { ok: false, error: `The registry holds ${MAX_ACCOUNTS} accounts at most.` };
  const v = validateAccount(input, { isNew: !existing, brokerIds: ctx.brokerIds });
  if (!v.ok) return { ok: false, error: v.errors.join(' '), errors: v.errors };
  const c = v.clean;
  const dists = allDistributables(store, ctx.self);
  const distributableId = c.distributableId || (existing && existing.distributableId) || ctx.self.id;
  if (!dists.some((d) => d.id === distributableId)) return { ok: false, error: 'That distributable is not in the registry.' };
  const now = ctx.now || Date.now();
  const next = {
    ...(existing || { id: newId('ba'), createdAt: new Date(now).toISOString() }),
    brokerId: c.brokerId, label: c.label, clientId: c.clientId, apiKey: c.apiKey || (existing ? existing.apiKey : ''),
    secret: c.secret || (existing ? existing.secret : null),
    distributableId, primaryIp: c.primaryIp, secondaryIp: c.secondaryIp,
    sharedWithFamily: c.sharedWithFamily, notes: c.notes, updatedAt: new Date(now).toISOString(),
  };
  // A different key or a new secret is a different Kite app: the old session does not belong to it.
  if (existing && ((c.apiKey && c.apiKey !== existing.apiKey) || c.secret)) next.session = null;
  const change = checkIpChange(existing, next, now, c.acknowledgeWeeklyLimit);
  if (!change.ok) return change;
  if (!(change.unchanged)) next.ipChangedAt = new Date(now).toISOString();
  else next.ipChangedAt = existing.ipChangedAt || null;
  const conflict = checkIpConflicts(accounts.filter((a) => a.id !== next.id), next);
  if (!conflict.ok) return conflict;
  const list = existing ? accounts.map((a) => (a.id === next.id ? next : a)) : [...accounts, next];
  store.set(DOMAIN, 'accounts', list);
  return { ok: true, created: !existing, account: view(next, { selfId: ctx.self.id, now }) };
}

function removeAccount(store, id) {
  const { accounts } = read(store);
  if (!accounts.some((a) => a.id === id)) return { ok: false, error: 'That account no longer exists.' };
  store.set(DOMAIN, 'accounts', accounts.filter((a) => a.id !== id));
  return { ok: true };
}

function saveDistributable(store, input, ctx) {
  const { distributables } = read(store);
  const label = text(input && input.label).slice(0, 60);
  if (!label) return { ok: false, error: 'Give the distributable a label.' };
  const id = text(input && input.id);
  if (id === ctx.self.id) return { ok: false, error: 'This installation is always present and cannot be edited here.' };
  if (!id && distributables.length >= MAX_DISTRIBUTABLES) return { ok: false, error: `The registry holds ${MAX_DISTRIBUTABLES} distributables at most.` };
  if (distributables.some((d) => d.id !== id && d.label.toLowerCase() === label.toLowerCase())) return { ok: false, error: 'A distributable with that label already exists.' };
  const notes = text(input && input.notes).slice(0, 200);
  if (id) {
    if (!distributables.some((d) => d.id === id)) return { ok: false, error: 'That distributable no longer exists.' };
    store.set(DOMAIN, 'distributables', distributables.map((d) => (d.id === id ? { ...d, label, notes } : d)));
    return { ok: true, id };
  }
  const d = { id: newId('dist'), label, notes, createdAt: new Date(ctx.now || Date.now()).toISOString() };
  store.set(DOMAIN, 'distributables', [...distributables, d]);
  return { ok: true, id: d.id };
}

/** A distributable that still has accounts cannot be removed: orphaned IPs would silently leave the rules. */
function removeDistributable(store, id, ctx) {
  const { distributables, accounts } = read(store);
  if (id === ctx.self.id) return { ok: false, error: 'This installation cannot be removed.' };
  if (!distributables.some((d) => d.id === id)) return { ok: false, error: 'That distributable no longer exists.' };
  if (accounts.some((a) => a.distributableId === id)) return { ok: false, error: 'Remove or move its accounts first.' };
  store.set(DOMAIN, 'distributables', distributables.filter((d) => d.id !== id));
  return { ok: true };
}

function recordDetected(store, ip, source, now = Date.now()) {
  const c = classifyIp(ip);
  if (!c.ok) return { ok: false, error: `The address reported (${text(ip).slice(0, 45)}) is not a public IP: ${c.reason}` };
  const { settings } = read(store);
  const detected = { ip: c.ip, at: new Date(now).toISOString(), source: text(source).slice(0, 80) };
  store.set(DOMAIN, 'settings', { ...settings, detected });
  return { ok: true, detected };
}

/** What the token exchange needs, for the main process only. No channel returns it. */
function credentialsFor(store, id) {
  const a = read(store).accounts.find((x) => x.id === id);
  return a ? { brokerId: a.brokerId, apiKey: a.apiKey, secret: a.secret || null } : null;
}

function saveSession(store, id, session) {
  const { accounts } = read(store);
  if (!accounts.some((a) => a.id === id)) return { ok: false, error: 'That account no longer exists.' };
  store.set(DOMAIN, 'accounts', accounts.map((a) => (a.id === id ? { ...a, session: { ...session } } : a)));
  return { ok: true };
}

function clearSession(store, id) {
  const { accounts } = read(store);
  if (!accounts.some((a) => a.id === id)) return { ok: false, error: 'That account no longer exists.' };
  store.set(DOMAIN, 'accounts', accounts.map((a) => (a.id === id ? { ...a, session: null } : a)));
  return { ok: true };
}

/** The key and live token, for a main-process caller making a data request. Null unless the session is live. */
function liveSession(store, id, now = Date.now()) {
  const a = read(store).accounts.find((x) => x.id === id);
  if (!a || !a.session || kite.sessionState(a.session, now) !== 'live') return null;
  return { apiKey: a.apiKey, accessToken: a.session.accessToken };
}

/** The secret, for a main-process caller that needs to USE it. Not reachable from any channel in this repo. */
function secretFor(store, id) {
  const a = read(store).accounts.find((x) => x.id === id);
  return a && a.secret ? a.secret : null;
}

module.exports = {
  DOMAIN, MAX_ACCOUNTS, MAX_DISTRIBUTABLES, WEEK_MS, MIN_SECRET,
  classifyIp, normaliseIps, checkIpChange, checkIpConflicts, validateAccount, maskKey,
  view, snapshot, saveAccount, removeAccount, saveDistributable, removeDistributable, recordDetected,
  secretFor, allDistributables, read, credentialsFor, saveSession, clearSession, liveSession, sessionView,
};
