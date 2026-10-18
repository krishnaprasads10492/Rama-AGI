/**
 * verifyInstanceAuthority.cjs - who may express a gene, and what the failover may do alone
 * (spec Section 150.1, D12)
 *
 * The defect: `express(id, gene, null)` skipped the tier check, `selfCare` passed null deliberately, and
 * its comment promised a bound that did not exist. The 120-second sweep could therefore express any of
 * the 31 genes on any sibling, nine of them tier 0. Also: a gene's `requires` came with it unchecked, so
 * a tier-4 request could add a tier-0 gene through g.store, g.vector or g.self-model.
 *
 * Real `instanceManager`, real genome, real capability matrix, and the real `selfCare` failover.
 *
 * Run:  node scripts/verifyInstanceAuthority.cjs
 */

'use strict';

const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');

let pass = 0;
let fail = 0;
function check(label, ok, detail = '') {
  if (ok) { pass += 1; console.warn(`  PASS  ${label}`); }
  else { fail += 1; console.warn(`  FAIL  ${label}${detail ? ` - ${detail}` : ''}`); }
}
const section = (s) => console.warn(`\n--- ${s} ---`);

const genome = require(path.join(ROOT, 'electron/genome.cjs'));
const caps = require(path.join(ROOT, 'electron/lib/capability.cjs'));
const im = require(path.join(ROOT, 'electron/ipc/instanceManager.cjs'));
const principalBinding = require(path.join(ROOT, 'electron/lib/principalBinding.cjs'));

const GENES = genome.GENES || genome.genes;
const tierOf = (id) => { const g = GENES.find((x) => x.id === id); return g && g.cap ? caps.MATRIX[g.cap] : undefined; };
const closureOf = (id, seen = new Set()) => {
  if (seen.has(id)) return seen;
  seen.add(id);
  (GENES.find((x) => x.id === id)?.requires || []).forEach((r) => closureOf(r, seen));
  return seen;
};
const user = (tier) => ({ tier, id: `u${tier}`, userId: `u${tier}` });

function freshInstance(opts = {}) {
  im.instances.clear();
  const res = im.spawn({ role: 'sentinel-lite', ...opts });
  return res.ok ? im.instances.get(res.data.id) : null;
}
/**
 * An instance with NOTHING expressed, so every gene's full dependency closure is what express() would
 * add. A fresh sentinel already expresses g.crypto, so adding g.vector to it genuinely adds no tier-0 gene
 * and is rightly allowed: the check is on what is NEW, and a fixture that ignored that tested nothing.
 */
function blank(opts = {}) {
  const inst = freshInstance(opts);
  inst.expressed = [];
  inst.dormant = GENES.map((g) => g.id);
  return inst;
}

(async () => {
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  section('the facts this suite stands on, measured from the real genome and matrix');
  const tier0 = GENES.filter((g) => tierOf(g.id) === 0).map((g) => g.id);
  check('there are 31 genes', GENES.length === 31, String(GENES.length));
  check('nine of them are tier 0', tier0.length === 9, tier0.join(','));
  const leaky = GENES.filter((g) => Math.min(...[...closureOf(g.id)].map((i) => tierOf(i) ?? 9)) < tierOf(g.id));
  check('exactly three reach a MORE privileged gene through `requires` (g.store, g.vector, g.self-model)',
    leaky.map((g) => g.id).sort().join(',') === 'g.self-model,g.store,g.vector', leaky.map((g) => g.id).join(','));
  check('the matrix declares instances.express as master-only', caps.MATRIX['instances.express'] === 0);
  check('SYSTEM_ACTOR is exported, frozen, and carries no tier',
    Object.isFrozen(im.SYSTEM_ACTOR) && im.SYSTEM_ACTOR.tier === undefined);

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  section('a missing actor is DENIED (it used to mean "no gate")');
  let inst = freshInstance({ ownerTier: 0 });
  check('an instance with dormant genes exists to test against', inst && inst.dormant.length > 0);
  const anyGene = inst.dormant[0];
  for (const [label, actor] of [['null', null], ['undefined', undefined], ['omitted', 'OMIT']]) {
    const r = actor === 'OMIT' ? im.express(inst.id, anyGene) : im.express(inst.id, anyGene, actor);
    check(`express with the actor ${label} is refused`, r.ok === false && /signed-in account/.test(r.error), JSON.stringify(r));
  }
  check('nothing was expressed by the refused calls', !im.instances.get(inst.id).expressed.includes(anyGene));
  // A gene the REAL system actor is allowed to express. Testing look-alikes against a gene the real actor
  // would also be refused (a tier-0 one) proves nothing: the refusal would come from the gene, not the
  // actor, and a look-alike accepted as the system would pass unnoticed.
  const movableOnBlank = (() => {
    const b = blank({ ownerTier: 0 });
    const g = GENES.find((x) => [...closureOf(x.id)].every((i) => (tierOf(i) ?? 0) >= 1));
    return { inst: b, gene: g.id };
  })();
  const realOk = im.express(movableOnBlank.inst.id, movableOnBlank.gene, im.SYSTEM_ACTOR);
  check(`control: the REAL system actor IS allowed to express ${movableOnBlank.gene} here`, realOk.ok === true, JSON.stringify(realOk));
  for (const forged of [{ system: true, name: 'instance-failover' }, { system: true }, { tier: '0' }, 'system', 0, true, []]) {
    const fresh = blank({ ownerTier: 0 });
    const r = im.express(fresh.id, movableOnBlank.gene, forged);
    check(`a look-alike actor ${JSON.stringify(forged)} is not the system actor and not a user`,
      r.ok === false && im.instances.get(fresh.id).expressed.length === 0, JSON.stringify(r));
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  section('a user may add only what their tier holds - now for the whole closure');
  for (const gid of ['g.store', 'g.vector', 'g.self-model']) {
    const r1 = blank();
    const t = tierOf(gid);
    const res = im.express(r1.id, gid, user(t));
    check(`${gid} is tier ${t}; a tier-${t} user is REFUSED because its dependency closure contains a tier-0 gene`,
      res.ok === false && /requires "/.test(res.error), JSON.stringify(res));
    check(`and nothing from that closure was added to the instance`, im.instances.get(r1.id).expressed.length === 0);
  }
  const already = freshInstance();
  const vec = im.express(already.id, 'g.vector', user(4));
  check('control: where the tier-0 dependency is ALREADY expressed, adding g.vector adds nothing tier-0 and is allowed',
    already.dormant.includes('g.vector') ? vec.ok === true : true, JSON.stringify(vec).slice(0, 120));
  const r2 = blank();
  const reachable = GENES.find((g) => [...closureOf(g.id)].every((i) => (tierOf(i) ?? 9) >= 3));
  if (reachable) {
    const ok = im.express(r2.id, reachable.id, user(3));
    check(`a gene whose whole closure is tier 3+ (${reachable.id}) IS expressible by a tier-3 user`, ok.ok === true, JSON.stringify(ok));
  } else {
    check('a tier-3-reachable dormant gene exists on a fresh sentinel', false, 'fixture assumption');
  }
  const r3 = blank();
  const loyal = r3.dormant.find((gid) => tierOf(gid) === 0);
  if (loyal) {
    const denied = im.express(r3.id, loyal, user(1));
    check('a tier-1 user cannot express a tier-0 gene', denied.ok === false);
    const allowed = im.express(r3.id, loyal, user(0));
    check('master can', allowed.ok === true, JSON.stringify(allowed));
  } else {
    check('a dormant tier-0 gene exists on a fresh sentinel', false, 'fixture assumption');
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  section('the system actor may NEVER express the loyalty class, directly or through a dependency');
  let tier0Reached = 0;
  let tier0Total = 0;
  let safeRefused = 0;
  let safeTotal = 0;
  for (const gid of GENES.map((g) => g.id)) {
    const x = blank({ ownerTier: 0 });                       // nothing expressed: the WHOLE closure is new
    const reachesTier0 = [...closureOf(gid)].some((i) => tierOf(i) === 0);
    const res = im.express(x.id, gid, im.SYSTEM_ACTOR);
    if (reachesTier0) { tier0Total += 1; if (res.ok) tier0Reached += 1; }
    else { safeTotal += 1; if (!res.ok) safeRefused += 1; }
  }
  check('across EVERY gene whose closure includes a tier-0 gene, the system actor expressed NONE',
    tier0Total > 0 && tier0Reached === 0, `${tier0Reached} of ${tier0Total} were expressed`);
  check('(non-vacuous: that covers the nine tier-0 genes and the three that reach one through `requires`)',
    tier0Total >= 12, String(tier0Total));
  check('and it did not just refuse everything: every gene with no tier-0 in its closure WAS expressible',
    safeTotal > 0 && safeRefused === 0, `${safeRefused} of ${safeTotal} refused`);

  const sx = blank({ ownerTier: 0 });
  const sysDirect = sx.dormant.find((gid) => tierOf(gid) === 0);
  const rs = im.express(sx.id, sysDirect, im.SYSTEM_ACTOR);
  check('a tier-0 gene named directly is refused with its reason', rs.ok === false && /tier-0 gene/.test(rs.error), JSON.stringify(rs));

  const ok3 = freshInstance({ ownerTier: 0 });
  const lowGene = GENES.find((g) => ok3.dormant.includes(g.id) && [...closureOf(g.id)].every((i) => (tierOf(i) ?? 0) >= 3));
  check('a low-tier gene IS still expressible by the system: failover keeps working (I11)',
    lowGene && im.express(ok3.id, lowGene.id, im.SYSTEM_ACTOR).ok === true);

  section('and never beyond the instance\'s recorded owner tier');
  const owned = freshInstance({ ownerTier: 4 });
  const tier3Gene = GENES.find((g) => owned.dormant.includes(g.id) && [...closureOf(g.id)].every((i) => (tierOf(i) ?? 0) >= 1) && tierOf(g.id) <= 3 && tierOf(g.id) >= 1);
  if (tier3Gene) {
    const r = im.express(owned.id, tier3Gene.id, im.SYSTEM_ACTOR);
    check(`an instance owned at tier 4 does not receive ${tier3Gene.id} (tier ${tierOf(tier3Gene.id)}) from the system`,
      r.ok === false && /more privileged than this instance's owner/.test(r.error), JSON.stringify(r));
  } else {
    check('a tier 1-3 dormant gene exists for the owner-tier test', false, 'fixture assumption');
  }
  const ownerless = freshInstance({});
  check('an instance with no recorded owner tier is bounded only by "never tier 0"',
    ownerless.ownerTier === null);
  const tier3OnOwnerless = GENES.find((g) => ownerless.dormant.includes(g.id) && [...closureOf(g.id)].every((i) => (tierOf(i) ?? 0) >= 3));
  check('so it can still receive ordinary genes from failover (no capability removed)',
    tier3OnOwnerless && im.express(ownerless.id, tier3OnOwnerless.id, im.SYSTEM_ACTOR).ok === true);
  check('ownerTier is recorded from spawn', freshInstance({ ownerTier: 2 }).ownerTier === 2);
  check('a non-integer ownerTier is stored as null, not as a number a caller invented',
    freshInstance({ ownerTier: '0' }).ownerTier === null && freshInstance({ ownerTier: 0.5 }).ownerTier === null);

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  section('the REAL failover, end to end (selfCare.checkInstanceFailover)');
  // Force the condition: one dead gene that an active instance expresses and a sibling holds dormant.
  const realVerify = genome.verify;
  im.instances.clear();
  const a = im.spawn({ role: 'prime', ownerTier: 0 });
  const b = im.spawn({ role: 'sentinel-lite', ownerTier: 0 });
  const instA = im.instances.get(a.data.id);
  const instB = im.instances.get(b.data.id);
  const victim = instB.dormant.find((gid) => tierOf(gid) === 0 && instA.expressed.includes(gid));
  check('fixture: a tier-0 gene is expressed on the prime and dormant on the sibling', !!victim, String(victim));

  genome.verify = () => ({ total: 31, live: 30, degraded: 0, healthy: false,
    genes: GENES.map((g) => ({ id: g.id, live: g.id !== victim })) });
  const selfCare = require(path.join(ROOT, 'electron/ipc/selfCare.cjs'));
  const out = await selfCare.checkInstanceFailover();
  genome.verify = realVerify;

  check('the failover RAN and tried to heal the dead tier-0 gene', out.actions.some((x) => x.geneId === victim), JSON.stringify(out.actions).slice(0, 200));
  check('and was REFUSED: the 120-second sweep did not express a loyalty-class gene',
    out.actions.length > 0 && out.actions.every((x) => x.ok === false), JSON.stringify(out.actions).slice(0, 220));
  check('the sibling still holds it dormant', im.instances.get(instB.id).dormant.includes(victim)
    && !im.instances.get(instB.id).expressed.includes(victim));

  // And the same sweep with a gene it IS allowed to move.
  const movable = instB.dormant.find((gid) => tierOf(gid) >= 3 && [...closureOf(gid)].every((i) => tierOf(i) >= 3) && instA.expressed.includes(gid));
  genome.verify = () => ({ total: 31, live: 30, degraded: 0, healthy: false,
    genes: GENES.map((g) => ({ id: g.id, live: g.id !== movable })) });
  const out2 = await selfCare.checkInstanceFailover();
  genome.verify = realVerify;
  check('a movable (tier 3+) gene is healed on the sibling: failover still works',
    !!movable && out2.actions.some((x) => x.geneId === movable && x.ok === true), JSON.stringify(out2.actions).slice(0, 220));

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  section('the IPC channels (real handlers, the principal supplied by main, not by the caller)');
  const handlers = new Map();
  im.register({ handle: (c, f) => handlers.set(c, f), on() {}, once() {} });
  check('thirteen instance channels are registered', handlers.size === 13, String(handlers.size));

  const authCore = require(path.join(ROOT, 'electron/lib/authCore.cjs'));
  const pOf = {};
  principalBinding.useAuth({
    validateSession: (tok) => (pOf[tok] ? { userId: pOf[tok].userId } : null),
    findById: (id) => Object.values(pOf).find((u) => u.userId === id) || null,
    publicUser: (u) => ({ ...u, id: u.userId }),
  });
  const mkWin = (id, tok, acct) => { pOf[tok] = { userId: `acct-${tok}`, username: tok, ...acct }; principalBinding.bind({ id }, tok, 'fp'); return { sender: { id } }; };
  const masterWin = mkWin(901, 'm', { tier: 0 });
  const adminWin = mkWin(902, 'a', { tier: 2 });
  const guestWin = mkWin(903, 'g', { tier: 5 });
  const nobody = { sender: { id: 999 } };
  const call = (ch, win, ...args) => handlers.get(ch)(win, ...args);

  im.instances.clear();
  check('no session: spawn is refused', (await call('instance:spawn', nobody, { role: 'sentinel-lite' })).ok === false);
  check('a guest cannot spawn', (await call('instance:spawn', guestWin, { role: 'sentinel-lite' })).ok === false);
  check('an admin (tier 2) cannot spawn: instances.spawn is tier 1', (await call('instance:spawn', adminWin, { role: 'sentinel-lite' })).ok === false);
  const sp = await call('instance:spawn', masterWin, { role: 'sentinel-lite', ownerTier: 5, owner: 'forged' });
  check('master can spawn', sp.ok === true, JSON.stringify(sp));
  check('and the owner and owner tier are what MAIN knows, overriding what the caller put in opts',
    sp.ok && im.instances.get(sp.data.id).ownerTier === 0 && im.instances.get(sp.data.id).owner === 'acct-m');
  const target = sp.data.id;
  const gdormant = im.instances.get(target).dormant.find((gid) => tierOf(gid) === 0);
  check('a guest cannot express, whatever they put in the third argument',
    (await call('instance:express', guestWin, target, gdormant, { tier: 0, id: 'x' })).ok === false);
  check('an admin cannot express (instances.express is master-only)',
    (await call('instance:express', adminWin, target, gdormant)).ok === false);
  check('with no session, express is refused', (await call('instance:express', nobody, target, gdormant)).ok === false);
  const mx = await call('instance:express', masterWin, target, gdormant);
  check('master can express, with no user argument at all - which is what Genome.jsx sends', mx.ok === true, JSON.stringify(mx));
  check('an admin can view', (await call('instance:list', adminWin, {})).ok === true);
  check('a guest cannot view', (await call('instance:list', guestWin, {})).ok === false);
  check('a guest cannot terminate', (await call('instance:terminate', guestWin, target)).ok === false);
  check('a signed-in guest CAN call ensure-prime (the app does at start-up for every tier)',
    (await call('instance:ensure-prime', guestWin)).ok === true);
  check('no session cannot', (await call('instance:ensure-prime', nobody)).ok === false);
  check('the prime was spawned with the caller\'s tier recorded',
    [...im.instances.values()].some((i) => i.role === 'prime' && i.ownerTier === 5));
  principalBinding.useAuth(null);
  principalBinding.reset();

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  section('structure');
  const src = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
  const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const imSrc = code(src('electron/ipc/instanceManager.cjs'));
  const scSrc = code(src('electron/ipc/selfCare.cjs'));
  check('selfCare no longer passes null to express', !/\.express\([^)]*,\s*null\)/.test(scSrc));
  check('selfCare passes the named system actor', /\.express\(target\.id, geneId, instMod\.SYSTEM_ACTOR\)/.test(scSrc));
  check('what is authorised and what is added are ONE set (no second traversal of `requires`)',
    (imSrc.match(/\.requires\.forEach/g) || []).length === 1);
  check('every instance:* registration is gated or signed-in-only (none is bare)',
    !/ipcMain\.handle\('instance:[a-z-]+',\s*async/.test(imSrc));

  console.warn(`\n${fail ? 'FAILED' : 'ALL PASS'} - ${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})().catch((err) => { console.error('suite crashed:', err); process.exit(1); });
