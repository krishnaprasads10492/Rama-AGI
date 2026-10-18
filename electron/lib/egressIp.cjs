'use strict';

/**
 * egressIp.cjs - what address does the internet see this machine as? (spec Section 152.2 #6)
 *
 * Asked of an IP-echo service through `lib/http.cjs` (invariant I9: one HTTP client). It is explicit, never on a
 * timer, and it TELLS A THIRD PARTY THIS MACHINE'S ADDRESS, which the button that calls it says.
 *
 * The endpoint is configurable but must be https, and it must not point at a private host: a configured
 * "echo" on localhost would let a setting turn this into a probe of the local network.
 */

const brokerAccounts = require('./brokerAccounts.cjs');

const DEFAULT_URL = 'https://api.ipify.org?format=json';

function endpointOk(url) {
  let u;
  try { u = new URL(String(url)); } catch { return { ok: false, error: 'The IP-echo address is not a valid URL.' }; }
  if (u.protocol !== 'https:') return { ok: false, error: 'The IP-echo address must be https.' };
  if (u.username || u.password) return { ok: false, error: 'The IP-echo address must not carry credentials.' };
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return { ok: false, error: 'The IP-echo address must be a public host.' };
  const asIp = brokerAccounts.classifyIp(host);
  const looksIp = /^[0-9.]+$/.test(host) || host.includes(':');
  if (looksIp && !asIp.ok) return { ok: false, error: 'The IP-echo address must be a public host.' };
  return { ok: true, url: u.toString() };
}

/**
 * @param {{getJson: Function}} http  the lib/http.cjs client (injected so this is testable without a network)
 * @param {string} [url]
 * @returns {Promise<{ok:boolean, ip?:string, source?:string, error?:string}>}
 */
async function detect(http, url = DEFAULT_URL) {
  const ep = endpointOk(url);
  if (!ep.ok) return ep;
  let res;
  try { res = await http.getJson(ep.url, { timeout: 8000, retries: 1 }); }
  catch (err) { return { ok: false, error: `The IP-echo service could not be reached: ${err.message}` }; }
  if (!res || res.error) return { ok: false, error: `The IP-echo service did not answer: ${res && res.error ? res.error : 'no reply'}` };
  const raw = typeof res.ip === 'string' ? res.ip : (typeof res.origin === 'string' ? res.origin.split(',')[0] : '');
  const c = brokerAccounts.classifyIp(raw);
  if (!c.ok) return { ok: false, error: `The service reported "${String(raw).slice(0, 45)}", which is not a public IP: ${c.reason}` };
  return { ok: true, ip: c.ip, source: new URL(ep.url).hostname };
}

module.exports = { detect, endpointOk, DEFAULT_URL };
