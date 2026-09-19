#!/usr/bin/env node
'use strict';

/**
 * verifyPopoutGrant.cjs — the ticket that lets a pop-out adopt the opener's session (Section 109).
 *
 * This moves an authenticated identity between windows, so the assertions are mostly about what must
 * NOT work: replay, expiry, a grant with no user, and a grant that outlives its window.
 *
 * Run: node scripts/verifyPopoutGrant.cjs   (or npm run verify:popout)
 */

const g = require('../electron/lib/popoutGrant.cjs');

let pass = 0;
let fail = 0;
const check = (label, ok, detail) => {
  if (ok) { pass += 1; console.log(`  PASS  ${label}`); }
  else { fail += 1; console.log(`  FAIL  ${label}${detail ? ` - ${detail}` : ''}`); }
};

const USER = { id: 'u1', name: 'Krishna', tier: 0 };
let clock = 1_000_000;
g.useClock(() => clock);
const reset = () => { g.clearAll(); clock = 1_000_000; };

console.log('\npop-out grants — single use, short lived, no new authority\n');

console.log('  minting');
reset();
const t1 = g.mint({ user: USER, panel: 'chart' });
check('a ticket is minted for a real user and panel', typeof t1 === 'string' && t1.length >= 64);
check('tickets are unguessable', /^[0-9a-f]{64}$/.test(t1));
check('two mints never collide', g.mint({ user: USER, panel: 'chart' }) !== t1);
check('no user means no ticket — it would redeem into a fake session',
  g.mint({ user: null, panel: 'chart' }) === null);
check('a user without an id is refused', g.mint({ user: { name: 'x' }, panel: 'chart' }) === null);
check('a non-object user is refused', g.mint({ user: 'master', panel: 'chart' }) === null);
check('no panel means no ticket', g.mint({ user: USER, panel: null }) === null);
check('no arguments at all is refused', g.mint() === null);

reset();
check('the user is snapshotted, not referenced', (() => {
  const live = { id: 'u1', tier: 0 };
  const t = g.mint({ user: live, panel: 'chart' });
  live.tier = 99;                      // a later mutation must not reach the grant
  return g.redeem(t, 1).user.tier === 0;
})());

console.log('\n  redemption is once and only once');
reset();
const t2 = g.mint({ user: USER, panel: 'book' });
const first = g.redeem(t2, 7);
check('the first redemption succeeds', first.ok === true);
check('and returns the user', first.user.id === 'u1');
check('and the panel it was minted for', first.panel === 'book');
const second = g.redeem(t2, 7);
check('a replay is refused', second.ok === false);
check('and says why', /already used|unknown/.test(second.reason), second.reason);
check('a replay from a different window is also refused', g.redeem(t2, 99).ok === false);
check('the ticket is gone from the map', g.liveCount() === 0);

console.log('\n  expiry');
reset();
const t3 = g.mint({ user: USER, panel: 'chart' });
clock += g.TTL_MS - 1;
check('a ticket inside its window still redeems', g.redeem(t3, 1).ok === true);
reset();
const t4 = g.mint({ user: USER, panel: 'chart' });
clock += g.TTL_MS + 1;
const late = g.redeem(t4, 1);
check('a ticket past its window is refused', late.ok === false);
check('and says it expired', /expired/.test(late.reason), late.reason);
check('expired tickets are swept rather than accumulating', g.liveCount() === 0);
check('the window is short — under a minute', g.TTL_MS <= 60_000);

console.log('\n  unknown and hostile input');
reset();
for (const bad of [null, undefined, '', 0, {}, [], 'deadbeef', '../../etc', '__proto__']) {
  let threw = null;
  let res = null;
  try { res = g.redeem(bad, 1); } catch (e) { threw = e.message; }
  check(`redeem(${JSON.stringify(bad)}) is refused without throwing`,
    threw === null && res && res.ok === false, threw || JSON.stringify(res));
}
check('a prototype key cannot masquerade as a ticket',
  g.redeem('__proto__', 1).ok === false && g.liveCount() === 0);

console.log('\n  bounded, and revocable with the window');
reset();
for (let i = 0; i < g.MAX_LIVE + 8; i += 1) g.mint({ user: USER, panel: `p${i}` });
check('the live map is bounded, so minting cannot exhaust memory',
  g.liveCount() <= g.MAX_LIVE, String(g.liveCount()));
reset();
const keep = g.mint({ user: USER, panel: 'chart' });
g.mint({ user: USER, panel: 'book' });
check('revoking one panel leaves the others', g.revokeForPanel('book') === 1 && g.liveCount() === 1);
check('and the survivor still works', g.redeem(keep, 1).ok === true);
check('revoking an unknown panel is a no-op', g.revokeForPanel('nope') === 0);
reset();
g.mint({ user: USER, panel: 'chart' });
g.clearAll();
check('clearAll empties the map', g.liveCount() === 0);

console.log('\n  it is not persisted, and it carries no capabilities');
{
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'electron', 'lib', 'popoutGrant.cjs'), 'utf8');
  check('nothing is written to disk — a crash must not leave a redeemable ticket',
    !/writeFile|readFile|dataStore|localStorage/.test(src));
  // The grant identifies a user; it must never decide what that user may do.
  check('no capability decision is made here',
    !/capabilit|\bcan\(/i.test(src.replace(/^\s*\*.*$/gm, '')));
  check('the token is from a CSPRNG', /crypto\.randomBytes/.test(src));
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
