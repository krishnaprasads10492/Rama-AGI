'use strict';

/**
 * verifyRefresh.cjs — the background schedule, and the upgrade advisor (Section 96).
 *
 * Timers, the clock, the store and randomness are all injected, so nothing here waits and nothing
 * touches the network.
 *
 * The assertions that matter most are the ones about NOT doing things: not stampeding at startup, not
 * retrying a broken endpoint forever, not claiming a package is safe when nobody checked, and not
 * letting an unverified comment on the internet decide an upgrade.
 *
 * Run: node scripts/verifyRefresh.cjs   (or npm run verify:refresh)
 */

const sched = require('../electron/lib/refreshScheduler.cjs');
const adv = require('../electron/lib/dependencyAdvisor.cjs');

let pass = 0;
let fail = 0;
function check(label, ok, detail) {
  if (ok) { pass += 1; console.log(`  PASS  ${label}`); }
  else { fail += 1; console.log(`  FAIL  ${label}${detail ? ` - ${detail}` : ''}`); }
}

const HOUR = 3600_000;
const DAY = 24 * HOUR;

function fakeStore(seed = {}) {
  const mem = new Map(Object.entries(seed));
  return {
    mem,
    get: (d, k) => mem.get(`${d}:${k}`),
    set: (d, k, v) => mem.set(`${d}:${k}`, v),
    saveDomain: () => {},
  };
}

(async () => {
  console.log('\nrefresh schedule and upgrade advisor\n');

  // ── 1. Registration ────────────────────────────────────────────────────────
  console.log('  registration');
  {
    sched.reset();
    sched.useStore(fakeStore());

    check('a task registers', sched.register({
      name: 'catalog', label: 'Model catalogue', intervalMs: DAY, run: async () => ({ ok: true }),
    }).ok);
    check('a task without a run function is refused',
      sched.register({ name: 'x', intervalMs: DAY }).ok === false);
    check('a task without an interval is refused',
      sched.register({ name: 'x', run: async () => ({ ok: true }) }).ok === false);
    check('a zero interval is refused',
      sched.register({ name: 'x', intervalMs: 0, run: async () => ({ ok: true }) }).ok === false);
    // Recorded so a scheduled action's authorisation is visible in one list rather than per task.
    check('the capability a task needs is recorded', (() => {
      sched.register({
        name: 'gated', intervalMs: DAY, capability: 'models.add-key',
        run: async () => ({ ok: true }),
      });
      return sched.status().tasks.find(t => t.name === 'gated').capability === 'models.add-key';
    })());
    check('a task can be unregistered', sched.unregister('gated') === true);
  }

  // ── 2. Persistence: a restart must not re-run everything ───────────────────
  console.log('\n  persistence across restart');
  {
    const now = 1_000_000_000_000;
    sched.reset();
    // A task that ran an hour ago, with a daily interval.
    sched.useStore(fakeStore({
      'config:refreshTasks': { daily: { lastRunAt: now - HOUR, lastOk: true, failures: 0 } },
    }));
    sched.register({ name: 'daily', intervalMs: DAY, run: async () => ({ ok: true }) });

    const task = sched.status({ now }).tasks[0];
    // THE POINT: without persistence every restart triggers every task, so a machine opened and
    // closed often would refresh constantly.
    check('a task that ran recently is NOT due again after a restart', task.overdue === false);
    check('its next due time is one interval after its last run',
      task.nextDueAt === now - HOUR + DAY, String(task.nextDueAt));
    check('the last outcome survives the restart', task.lastOk === true);

    sched.reset();
    sched.useStore(fakeStore());
    sched.register({ name: 'fresh', intervalMs: DAY, run: async () => ({ ok: true }) });
    check('a task that has never run is due immediately',
      sched.status({ now }).tasks[0].overdue === true);
  }

  // ── 3. Backoff: a broken endpoint must not retry forever ───────────────────
  console.log('\n  failure backoff');
  {
    check('no failures means no delay multiplier', sched.backoffMultiplier(0) === 1);
    check('failures multiply the interval', sched.backoffMultiplier(3) === 8);
    // Capped, so a permanently broken task still retries eventually rather than never.
    check('the multiplier is capped', sched.backoffMultiplier(50) === sched.BACKOFF_MAX_MULT);

    const now = 2_000_000_000_000;
    sched.reset();
    sched.useStore(fakeStore({
      'config:refreshTasks': { flaky: { lastRunAt: now, lastOk: false, failures: 4 } },
    }));
    sched.register({ name: 'flaky', intervalMs: HOUR, run: async () => ({ ok: false }) });
    const t = sched.status({ now }).tasks[0];
    check('a failing task waits longer than its interval',
      t.nextDueAt === now + HOUR * 16, String(t.nextDueAt - now));
    // Different states: backing off is not the same as simply not yet due.
    check('backing off is reported as its own state', t.backingOff === true);
    check('the failure count is visible rather than buried in logs', t.failures === 4);
    check('the last error is retained', t.lastError !== undefined);
  }

  // ── 4. Running a task, and surviving a thrown one ──────────────────────────
  console.log('\n  running tasks');
  {
    const store = fakeStore();
    sched.reset();
    sched.useStore(store);

    let ran = 0;
    sched.register({ name: 'ok', intervalMs: DAY, run: async () => { ran += 1; return { ok: true }; } });
    sched.register({ name: 'boom', intervalMs: DAY, run: async () => { throw new Error('network down'); } });
    sched.register({ name: 'sad', intervalMs: DAY, run: async () => ({ ok: false, error: 'http 503' }) });

    await sched.runNow('ok', { now: 100 });
    check('a task runs', ran === 1);
    check('success clears the failure count',
      sched.status({ now: 100 }).tasks.find(t => t.name === 'ok').failures === 0);

    // A background task that can crash the scheduler takes every other task down with it.
    const boom = await sched.runNow('boom', { now: 200 });
    check('a thrown task is caught, not propagated', boom.ok === false);
    check('and recorded as a failure',
      sched.status({ now: 200 }).tasks.find(t => t.name === 'boom').failures === 1);
    check('the thrown message is kept',
      /network down/.test(sched.status({}).tasks.find(t => t.name === 'boom').lastError));

    await sched.runNow('sad', { now: 300 });
    await sched.runNow('sad', { now: 400 });
    check('consecutive reported failures accumulate',
      sched.status({}).tasks.find(t => t.name === 'sad').failures === 2);

    check('an unknown task name is refused',
      (await sched.runNow('nope')).ok === false);
  }

  // ── 5. Startup must not stampede ───────────────────────────────────────────
  console.log('\n  startup spread');
  {
    sched.reset();
    sched.useStore(fakeStore());
    const delays = [];
    const setTimer = (fn, ms) => { delays.push(ms); return { unref() {} }; };

    for (let i = 0; i < 6; i += 1) {
      sched.register({ name: `t${i}`, intervalMs: DAY, run: async () => ({ ok: true }) });
    }
    // random() fixed at 0 so jitter does not obscure the spread being measured.
    const res = sched.start({ setTimer, now: () => 5_000_000, random: () => 0 });

    check('start reports how many tasks and how many are due',
      res.ok && res.tasks === 6 && res.due === 6, JSON.stringify(res));
    check('six due tasks produce six timers', delays.length === 6);
    // THE ASSERTION: ten simultaneous network calls at launch is slow, looks like abuse to a rate
    // limiter, and makes unrelated startup failures interdependent.
    check('they are NOT all scheduled for the same moment',
      new Set(delays).size > 1, JSON.stringify(delays));
    check('the spread stays within the startup window',
      Math.max(...delays) <= sched.STARTUP_SPREAD_MS, String(Math.max(...delays)));
    check('the first is immediate', Math.min(...delays) === 0);
    sched.stop();

    // Jitter, so many installs of Rāma do not converge on the same second.
    sched.reset();
    sched.useStore(fakeStore());
    sched.register({ name: 'j', intervalMs: DAY, run: async () => ({ ok: true }) });
    const a = [];
    sched.start({ setTimer: (f, ms) => { a.push(ms); return { unref() {} }; }, now: () => 1, random: () => 0 });
    sched.stop();
    const b = [];
    sched.reset();
    sched.useStore(fakeStore());
    sched.register({ name: 'j', intervalMs: DAY, run: async () => ({ ok: true }) });
    sched.start({ setTimer: (f, ms) => { b.push(ms); return { unref() {} }; }, now: () => 1, random: () => 1 });
    sched.stop();
    check('jitter shifts the schedule between installs', a[0] !== b[0], `${a[0]} vs ${b[0]}`);

    check('the whole schedule can be disabled by environment', (() => {
      process.env.RAMA_DISABLE_REFRESH = '1';
      sched.reset();
      sched.useStore(fakeStore());
      sched.register({ name: 'z', intervalMs: DAY, run: async () => ({ ok: true }) });
      const r = sched.start({ setTimer, now: () => 1, random: () => 0 });
      delete process.env.RAMA_DISABLE_REFRESH;
      return r.ok === false && r.disabled === true;
    })());
  }

  // ── 6. Advisor: version arithmetic ─────────────────────────────────────────
  console.log('\n  upgrade classification');
  {
    // A major bump is the author telling you it breaks. Ranking by recency would bury that.
    check('a major bump is breaking', adv.classifyJump('1.2.3', '2.0.0').kind === 'breaking');
    check('and says the author signalled it',
      /incompatible/.test(adv.classifyJump('1.2.3', '2.0.0').why));
    check('a minor bump is additive', adv.classifyJump('1.2.3', '1.3.0').kind === 'feature');
    check('a patch bump is a fix', adv.classifyJump('1.2.3', '1.2.4').kind === 'patch');
    check('equal versions are current', adv.classifyJump('1.2.3', '1.2.3').kind === 'current');
    // Usually means the release was pulled — a fact worth surfacing, not upgrading through.
    check('an older registry version is a downgrade',
      adv.classifyJump('2.0.0', '1.9.9').kind === 'downgrade');
    check('a non-semver version is unknown, not guessed',
      adv.classifyJump('latest', '1.0.0').kind === 'unknown');
    check('a v prefix is tolerated', adv.classifyJump('v1.0.0', 'v1.0.1').kind === 'patch');
  }

  // ── 7. THE HONESTY ASSERTIONS ──────────────────────────────────────────────
  console.log('\n  security status must not overstate');
  {
    const unchecked = adv.assess({ name: 'left-pad', pinned: '1.0.0', latest: '1.0.1' });
    check('with no advisory source the state is unchecked',
      unchecked.security.state === 'unchecked');
    // The tempting dishonesty: "nothing found" is not "safe".
    check('unchecked is NEVER reported as clean',
      unchecked.security.state !== 'verified-clean' && unchecked.security.state !== 'clean');
    check('and it is raised as a concern rather than passed over',
      unchecked.concerns.some(c => /Security status is unknown/.test(c)),
      JSON.stringify(unchecked.concerns));

    const looked = adv.assess({
      name: 'left-pad', pinned: '1.0.0', latest: '1.0.1',
      advisory: { checked: true, found: [] },
    });
    check('a source that looked and found nothing is distinguished',
      looked.security.state === 'no-advisory-found', looked.security.state);
    check('and says plainly that this is not a guarantee',
      /not the same as a guarantee/.test(looked.security.note), looked.security.note);

    const vuln = adv.assess({
      name: 'axios', pinned: '1.0.0', latest: '1.0.5',
      advisory: { checked: true, found: [{ id: 'GHSA-x', severity: 'high' }] },
    });
    check('a published advisory is reported as vulnerable',
      vuln.security.state === 'vulnerable');
    // The one case where NOT upgrading is the bigger risk.
    check('and an upgrade is recommended with urgency',
      vuln.recommend === 'upgrade recommended' && vuln.urgency === 'high');

    const vulnBreaking = adv.assess({
      name: 'axios', pinned: '1.0.0', latest: '2.0.0',
      advisory: { checked: true, found: [{ id: 'GHSA-y' }] },
    });
    check('a security fix behind a major bump is urgent BUT flagged as costly',
      vulnBreaking.urgency === 'high-with-care', vulnBreaking.urgency);
    check('and the meaning names both sides of that trade',
      /compatibility cost/.test(vulnBreaking.meaning) && /security one/.test(vulnBreaking.meaning),
      vulnBreaking.meaning);
  }

  // ── 8. Online commentary is signal, never measurement ──────────────────────
  console.log('\n  online commentary cannot decide, only inform');
  {
    const held = adv.assess({
      name: 'vite', pinned: '5.0.0', latest: '5.1.0',
      advisory: { checked: true, found: [] },
      signals: [
        { claim: 'This release breaks HMR on Windows', source: 'github.com/vitejs/vite#1234', date: '2026-09-01' },
        { claim: 'Works fine for me', source: 'reddit' },
      ],
    });
    check('commentary is carried through', held.signals.length === 2);
    // Stated on every one, so a reader never mistakes a comment for a finding.
    check('every signal is labelled an unverified claim',
      held.signals.every(s => s.status === 'unverified claim'));
    check('each signal keeps its source', held.signals.every(s => s.source));
    check('an unattributed signal says so',
      held.signals.find(s => s.source === 'reddit') !== undefined);
    check('a negative report holds the upgrade back', held.recommend === 'hold');
    check('and the reason names the reports without asserting them true',
      /unverified report/.test(held.meaning), held.meaning);

    // But commentary must NOT override a security fix: a comment is weaker evidence than an advisory.
    const secWins = adv.assess({
      name: 'axios', pinned: '1.0.0', latest: '1.0.1',
      advisory: { checked: true, found: [{ id: 'GHSA-z' }] },
      signals: [{ claim: 'this release is broken', source: 'forum' }],
    });
    check('a published advisory outweighs unverified commentary',
      secWins.recommend === 'upgrade recommended', secWins.recommend);

    const empty = adv.assess({
      name: 'x', pinned: '1.0.0', latest: '1.0.1',
      signals: [{ claim: '   ' }, null, { source: 'no claim here' }],
    });
    check('empty or malformed signals are dropped', empty.signals.length === 0);
  }

  // ── 9. Disk and sensitivity, master's stated concerns ──────────────────────
  console.log('\n  disk impact and blast radius');
  {
    const big = adv.assess({
      name: 'sharp', pinned: '0.33.0', latest: '0.34.0',
      advisory: { checked: true, found: [] },
      sizeBytes: 10 * 1024 * 1024, latestSizeBytes: 60 * 1024 * 1024,
    });
    // A delta, because "60 MB" matters far less than "+50 MB".
    check('disk impact is a delta, not a total',
      big.diskDeltaBytes === 50 * 1024 * 1024, String(big.diskDeltaBytes));
    check('a large increase is raised as a concern',
      big.concerns.some(c => /MB to the install/.test(c)), JSON.stringify(big.concerns));
    check('unknown sizes are null rather than zero',
      adv.assess({ name: 'x', pinned: '1.0.0', latest: '1.0.1' }).diskDeltaBytes === null);

    const sensitive = adv.assess({
      name: 'electron', pinned: '31.7.7', latest: '31.7.8',
      advisory: { checked: true, found: [] },
    });
    check('a package with wide blast radius is marked sensitive', sensitive.sensitive === true);
    check('even a patch bump on it needs master to decide',
      sensitive.recommend === 'master decides', sensitive.recommend);
    check('and it asks for a build and launch test',
      sensitive.concerns.some(c => /build and a launch test/.test(c)));
    check('argon2 is sensitive, because a change there can lock master out',
      adv.SENSITIVE.has('argon2'));

    const routine = adv.assess({
      name: 'uuid', pinned: '9.0.0', latest: '9.0.1',
      advisory: { checked: true, found: [] },
    });
    check('a routine patch on an ordinary package is safe to consider',
      routine.recommend === 'safe to consider', routine.recommend);

    // Being first to a release is a cost, not a benefit, for something master depends on.
    const brandNew = adv.assess({
      name: 'uuid', pinned: '9.0.0', latest: '10.0.0',
      advisory: { checked: true, found: [] }, releaseAgeDays: 2,
    });
    check('a days-old major release is flagged for its newness',
      brandNew.concerns.some(c => /early adopters/.test(c)), JSON.stringify(brandNew.concerns));
  }

  // ── 10. The review, and the proposal master actually sees ──────────────────
  console.log('\n  the approval list');
  {
    const r = adv.review([
      { name: 'uuid', pinned: '9.0.0', latest: '9.0.0', advisory: { checked: true, found: [] } },
      { name: 'electron', pinned: '31.0.0', latest: '32.0.0', advisory: { checked: true, found: [] } },
      { name: 'axios', pinned: '1.0.0', latest: '1.0.9', advisory: { checked: true, found: [{ id: 'G1' }] } },
      { name: 'vite', pinned: '5.0.0', latest: '5.1.0', advisory: { checked: true, found: [] },
        signals: [{ claim: 'breaks the build', source: 'gh' }] },
      { name: 'lodash', pinned: '4.0.0', latest: '4.0.1' },
    ]);

    check('every package is assessed', r.rows.length === 5);
    // The first row must be the one that matters, or the list is just an inventory.
    check('the security fix sorts to the top', r.rows[0].name === 'axios', r.rows[0].name);
    check('an up-to-date package is excluded from actionable',
      !r.actionable.some(x => x.name === 'uuid'));
    check('the summary counts what is vulnerable', r.summary.vulnerable === 1);
    check('and what would be a major bump', r.summary.breaking === 1);
    check('and what is being held back', r.summary.held === 1);
    // A zero here would otherwise read as "all clear".
    check('and how many could not be checked at all',
      r.summary.securityUnchecked === 1, String(r.summary.securityUnchecked));

    const p = adv.toProposal(r, { now: new Date('2026-09-09T00:00:00Z') });
    check('the proposal is a single entry, not one per package',
      p.kind === 'dependency-upgrade' && Array.isArray(p.meta.packages));
    check('its title leads with security relevance', /security relevance/.test(p.title), p.title);
    // It asks a question; it does not carry an edit. Applying is a separate deliberate act.
    check('the proposal carries NO code changes', p.changes.length === 0);
    check('it is marked high risk when a security fix is involved', p.risk === 'high');
    check('a sensitive package makes it restart-requiring', p.requiresRestart === true);
    check('the summary mentions the unchecked packages',
      /could not be checked/.test(p.summary), p.summary);
    check('each package in the proposal carries its reasoning',
      p.meta.packages.every(x => typeof x.meaning === 'string' && x.meaning.length > 10));
    check('and when it was generated', !Number.isNaN(Date.parse(p.meta.generatedAt)));
  }

  sched.reset();
  // No summary or exit here: a second phase follows and an exit at this point would stop it running.
  // That trap has already bitten this project once (row 99's note on appending to verify scripts).
})();

// ── 11. Registry adapter: where the advisor's facts come from ────────────────
//
// Appended as a second phase of this suite rather than a new file, because these rows are only
// meaningful as input to the advisor above — testing the adapter apart from the judgement it feeds
// would verify the shape and miss whether the two agree.
(async () => {
  const src = require('../electron/lib/registrySources.cjs');
  console.log('\n  registry and advisory adapter');

  // Shaped like a real npm packument, trimmed to the fields that are read.
  const PACKUMENT = {
    'dist-tags': { latest: '1.7.9' },
    versions: {
      '1.7.0': { dist: { unpackedSize: 1_000_000 } },
      '1.7.9': { dist: { unpackedSize: 2_500_000 } },
    },
    time: { '1.7.0': '2025-01-01T00:00:00Z', '1.7.9': '2026-09-01T00:00:00Z' },
  };

  const p = src.parsePackument(PACKUMENT);
  check('the latest dist-tag is read', p.latest === '1.7.9');
  check('the latest version size is read', p.latestSizeBytes === 2_500_000);
  check('a specific version size is readable', p.sizeForVersion('1.7.0') === 1_000_000);
  // npm omits unpackedSize on older publishes; a zero would read as "this package is empty".
  check('a missing size is null, never zero', src.parsePackument({
    'dist-tags': { latest: '1.0.0' }, versions: { '1.0.0': {} },
  }).latestSizeBytes === null);
  check('a packument with no latest tag is unusable, not half-parsed',
    src.parsePackument({ versions: {} }) === null);
  check('rubbish input yields null', src.parsePackument('nope') === null);
  check('a maintainer deprecation is captured', src.parsePackument({
    'dist-tags': { latest: '1.0.0' },
    versions: { '1.0.0': { deprecated: 'use foo instead' } },
  }).deprecated === 'use foo instead');

  check('scoped names are URL-encoded for the registry',
    src.npmUrl('@babel/parser').endsWith('@babel%2Fparser'), src.npmUrl('@babel/parser'));

  const osv = src.parseOsv({ vulns: [{ id: 'GHSA-1', summary: 'bad thing', severity: [{ score: 'CVSS:3.1/AV:N' }] }] });
  check('an advisory is parsed', osv.length === 1 && osv[0].id === 'GHSA-1');
  check('its severity is carried through unchanged rather than remapped',
    osv[0].severity === 'CVSS:3.1/AV:N');
  // OSV answers a specific version, so empty means "nothing known about THIS version".
  check('an empty vulns list yields no advisories', src.parseOsv({ vulns: [] }).length === 0);
  check('a malformed response yields no advisories', src.parseOsv(null).length === 0);

  check('release age is computed in days',
    src.daysSince('2026-09-01T00:00:00Z', new Date('2026-09-09T00:00:00Z')) === 8);
  check('an absent date yields null', src.daysSince(null, new Date()) === null);

  // ── collect(): the failure behaviour is the point ──────────────────────────
  const getJson = async (url) => {
    if (url.includes('axios')) return PACKUMENT;
    if (url.includes('broken')) throw new Error('ETIMEDOUT');
    return { 'dist-tags': { latest: '9.9.9' }, versions: { '9.9.9': {} }, time: {} };
  };
  const postJson = async () => ({ vulns: [] });

  const res = await src.collect({
    pinned: { axios: '1.7.0', broken: '1.0.0', uuid: '9.0.0' },
    getJson, postJson,
    now: new Date('2026-09-09T00:00:00Z'),
  });

  check('every package produces a row, including the failed one', res.rows.length === 3,
    String(res.rows.length));
  check('the failure is recorded with its reason',
    res.failures.some(f => f.name === 'broken' && /ETIMEDOUT/.test(f.reason)),
    JSON.stringify(res.failures));

  // THE ASSERTION THAT MATTERS: an unreachable package must not vanish and look fine by absence.
  const broken = res.rows.find(r => r.name === 'broken');
  check('an unreachable package is still present in the review', !!broken);
  check('it is marked unavailable rather than pretending to be current',
    broken.unavailable === true);
  check('its latest equals its pinned version, so the advisor recommends no action',
    broken.latest === broken.pinned);
  check('and the advisor classifies it as current rather than inventing an upgrade',
    adv.assess(broken).jump === 'current', adv.assess(broken).jump);

  const axios = res.rows.find(r => r.name === 'axios');
  check('a successful row carries both sizes for a disk delta',
    axios.sizeBytes === 1_000_000 && axios.latestSizeBytes === 2_500_000);
  check('and its release age', axios.releaseAgeDays === 8);
  check('an advisory lookup that ran is marked checked',
    axios.advisory.checked === true && axios.advisory.found.length === 0);
  check('so the advisor reports no-advisory-found rather than unchecked',
    adv.assess(axios).security.state === 'no-advisory-found');

  // Without a postJson, advisories must stay UNCHECKED rather than being assumed absent.
  const noAdv = await src.collect({ pinned: { axios: '1.7.0' }, getJson });
  check('with no advisory fetcher the row leaves advisory null', noAdv.rows[0].advisory === null);
  check('and the advisor surfaces that as unchecked, not safe',
    adv.assess(noAdv.rows[0]).security.state === 'unchecked');

  check('no fetcher at all is refused rather than returning an empty clean review',
    (await src.collect({ pinned: { a: '1' } })).failures.length === 1);

  check('rows come back in a stable order',
    res.rows.map(r => r.name).join(',') === 'axios,broken,uuid');

  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})();
