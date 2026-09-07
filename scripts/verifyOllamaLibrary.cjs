'use strict';

/**
 * verifyOllamaLibrary.cjs — Rāma reading Ollama's documents, and refusing to trust a bad read.
 *
 * The fixtures are shaped like the real pages. The parser is pure and the fetcher is injected, so
 * nothing here touches the network.
 *
 * THE ASSERTION THAT MATTERS MOST is that a failed parse never overwrites a good cache. A silent
 * cache wipe is the worst outcome available: retirement warnings stop firing, the shortlist goes
 * blank, and every symptom points at the wrong cause.
 *
 * Run: node scripts/verifyOllamaLibrary.cjs   (or npm run verify:ollama-lib)
 */

const lib = require('../electron/lib/ollamaLibrary.cjs');
const cat = require('../electron/lib/ollamaCatalog.cjs');

let pass = 0;
let fail = 0;
function check(label, ok, detail) {
  if (ok) { pass += 1; console.log(`  PASS  ${label}`); }
  else { fail += 1; console.log(`  FAIL  ${label}${detail ? ` - ${detail}` : ''}`); }
}

// Shaped like ollama.com/library?sort=newest — nested markup, capability tags, sizes, footer trio.
const LIBRARY_HTML = `
<div class="grid">
  <li x-test-model>
    <a href="/library/qwen3.8-flash-next"><h2>qwen3.8-flash-next</h2></a>
    <p>This experimental preview of the architecture that will underpin Qwen4.</p>
    <span>vision</span><span>tools</span><span>thinking</span>
    <div><span>85K</span><span>Pulls</span></div>
    <div><span>6</span><span>Tags</span></div>
    <div><span>Updated</span><span>yesterday</span></div>
  </li>
  <li x-test-model>
    <a href="/library/glm-5.3"><h2>glm-5.3</h2></a>
    <p>Z.ai's flagship model and the most capable open-weights model for coding.</p>
    <span>tools</span><span>thinking</span><span>cloud</span>
    <div><span>35.4K</span><span>Pulls</span></div>
    <div><span>1</span><span>Tag</span></div>
    <div><span>Updated</span><span>1 week ago</span></div>
  </li>
  <li x-test-model>
    <a href="/library/gemma4"><h2>gemma4</h2></a>
    <p>Gemma 4 models are designed to deliver frontier-level performance at each size.</p>
    <span>vision</span><span>tools</span><span>thinking</span><span>audio</span>
    <span>e4b</span><span>12b</span><span>26b</span><span>31b</span>
    <div><span>24.3M</span><span>Pulls</span></div>
    <div><span>50</span><span>Tags</span></div>
    <div><span>Updated</span><span>6 days ago</span></div>
  </li>
  <li x-test-model>
    <a href="/library/nomic-embed-text"><h2>nomic-embed-text</h2></a>
    <p>A high-performing open embedding model with a large token context window.</p>
    <span>embedding</span>
    <div><span>84.8M</span><span>Pulls</span></div>
    <div><span>3</span><span>Tags</span></div>
    <div><span>Updated</span><span>2 years ago</span></div>
  </li>
</div>`;

// Shaped like docs.ollama.com/cloud.
const RETIREMENT_HTML = `
<h2>Upcoming retirements</h2>
<table><tr><th>Retirement date</th><th>Model</th><th>Recommended alternative</th></tr>
<tr><td>July 31, 2026</td><td>minimax-m2.5</td><td>minimax-m2.7</td></tr>
<tr><td>July 31, 2026</td><td>kimi-k2.5</td><td>kimi-k2.6</td></tr>
</table>
<h2>Past retirements</h2>
<table><tr><th>Retirement date</th><th>Model</th><th>Recommended alternative</th></tr>
<tr><td>July 15, 2026</td><td>qwen3-coder:480b</td><td>qwen3.5:397b</td></tr>
<tr><td>July 15, 2026</td><td>gemma3:27b</td><td>gemma4:31b</td></tr>
</table>`;

function fakeStore() {
  const mem = new Map();
  return {
    mem,
    get: (d, k) => mem.get(`${d}:${k}`),
    set: (d, k, v) => mem.set(`${d}:${k}`, v),
    saveDomain: () => {},
  };
}

(async () => {
  console.log('\nollamaLibrary — reading the source, and refusing a bad read\n');

  // ── 1. Small parsers ───────────────────────────────────────────────────────
  console.log('  units');
  {
    check('119.2M becomes 119200000', lib.parseCount('119.2M') === 119200000);
    check('85K becomes 85000', lib.parseCount('85K') === 85000);
    check('a bare number is itself', lib.parseCount('412') === 412);
    check('rubbish becomes 0', lib.parseCount('n/a') === 0);

    check('1 year ago is 365 days', lib.parseAgeDays('1 year ago') === 365);
    check('2 weeks ago is 14 days', lib.parseAgeDays('2 weeks ago') === 14);
    check('6 days ago is 6', lib.parseAgeDays('6 days ago') === 6);
    // Recency drives a +30 band, so "yesterday" must not fall through to null and lose the credit.
    check('yesterday is treated as 1 day', lib.parseAgeDays('yesterday') === 1);
    check('an unparseable age is null', lib.parseAgeDays('a while back') === null);

    check('a date normalises to ISO', lib.normaliseDate('July 31, 2026') === '2026-07-31');
    check('an unparseable date is null', lib.normaliseDate('someday') === null);
    check('script contents are removed, not read as prose',
      !/alert/.test(lib.stripTags('<script>alert(1)</script>hello')));
  }

  // ── 2. Library parsing ─────────────────────────────────────────────────────
  console.log('\n  library parsing');
  {
    const parsed = lib.parseLibrary(LIBRARY_HTML);

    check('all four families are found', Object.keys(parsed).length === 4,
      JSON.stringify(Object.keys(parsed)));
    check('a dotted, dashed name survives', !!parsed['qwen3.8-flash-next']);
    check('capability tags are read', parsed['qwen3.8-flash-next'].tools === true
      && parsed['qwen3.8-flash-next'].thinking === true
      && parsed['qwen3.8-flash-next'].vision === true);
    // The distinction the whole of Section 92 rests on.
    check('the cloud tag is captured', parsed['glm-5.3'].cloud === true);
    check('a local family is not marked cloud', parsed.gemma4.cloud === false);
    check('pull counts are expanded', parsed.gemma4.pulls === 24300000, String(parsed.gemma4.pulls));
    check('sizes are collected', parsed.gemma4.sizes.includes('31b') && parsed.gemma4.sizes.includes('e4b'),
      JSON.stringify(parsed.gemma4.sizes));
    check('age is captured in days', parsed.gemma4.updatedDaysAgo === 6);
    check('an old family reads as old', parsed['nomic-embed-text'].updatedDaysAgo === 730);
    check('embedding models are marked', parsed['nomic-embed-text'].embedding === true);
    check('an embedding model has no tool calling', parsed['nomic-embed-text'].tools === false);
    check('descriptions are captured', /Qwen4/.test(parsed['qwen3.8-flash-next'].description));
    // A tag count of 6 must not be mistaken for 6 pulls.
    check('the Tags count is not confused with Pulls',
      parsed['qwen3.8-flash-next'].pulls === 85000, String(parsed['qwen3.8-flash-next'].pulls));

    check('empty input yields no families', Object.keys(lib.parseLibrary('')).length === 0);
    check('unrelated html yields no families',
      Object.keys(lib.parseLibrary('<p>nothing to see</p>')).length === 0);
  }

  // ── 3. Retirement parsing ──────────────────────────────────────────────────
  console.log('\n  retirement parsing');
  {
    const rows = lib.parseRetirements(RETIREMENT_HTML);

    check('all four rows are found', rows.length === 4, JSON.stringify(rows));
    const up = rows.find(r => r.model === 'minimax-m2.5');
    check('an upcoming row is not marked past', up && up.past === false);
    check('its alternative is paired correctly', up.alternative === 'minimax-m2.7');
    check('its date is ISO', up.date === '2026-07-31');

    const done = rows.find(r => r.model === 'qwen3-coder:480b');
    // `past` comes from the heading, not a clock comparison: the page is the authority on what has
    // already happened, and the machine clock may be wrong.
    check('a past row is marked past from its heading', done && done.past === true);
    check('a tagged model id survives', done.model === 'qwen3-coder:480b');
    check('its alternative is paired correctly', done.alternative === 'qwen3.5:397b');

    check('table headers are not read as models',
      !rows.some(r => /^(model|recommended|alternative)$/i.test(r.model)));
    check('empty input yields no rows', lib.parseRetirements('').length === 0);
  }

  // ── 4. refresh() — and the guard against wiping a good cache ───────────────
  console.log('\n  refresh, and refusing a bad read');
  {
    const store = fakeStore();
    cat.useStore(store);

    const good = async (url) => (url === lib.LIBRARY_URL ? LIBRARY_HTML : RETIREMENT_HTML);
    const first = await lib.refresh({ fetchText: good, now: new Date('2026-09-07T10:00:00Z') });

    check('a good refresh succeeds', first.ok === true && first.saved === true);
    check('it reports how many families it read', first.library.families === 4);
    check('it reports how many retirement rows it read', first.retirements.rows === 4);

    const loaded = cat.loadCatalog({ now: new Date('2026-09-07T10:30:00Z') });
    check('the catalogue is now populated', loaded.empty === false);
    check('and is not stale', loaded.stale === false);
    check('the source is recorded', /ollama\.com\/library/.test(loaded.source || ''));

    // THE CRITICAL GUARD: a redesigned page parses to nothing and must NOT wipe the cache.
    const blank = async () => '<html><body>redesigned</body></html>';
    const wiped = await lib.refresh({ fetchText: blank, now: new Date('2026-09-08T10:00:00Z') });

    check('a parse yielding nothing is refused', wiped.library.ok === false);
    check('and says why in plain terms',
      /keeping the cached catalogue/.test(wiped.library.reason || ''), wiped.library.reason);
    check('nothing is saved when both halves fail', wiped.saved === false);
    const after = cat.loadCatalog({ now: new Date('2026-09-08T10:00:00Z') });
    check('THE CACHE SURVIVES A FAILED PARSE', Object.keys(after.catalog).length === 4,
      String(Object.keys(after.catalog).length));
    check('the schedule survives too', after.schedule.length === 4);
    // fetchedAt untouched, so the cache keeps reporting its true age instead of looking fresh.
    check('a failed refresh does not fake a fresh timestamp',
      after.fetchedAt === loaded.fetchedAt);

    // A collapsed parse — matched a little — is also a parse failure, not a shrunken library.
    const collapsed = async (url) => (url === lib.LIBRARY_URL
      ? '<li><h2>gemma4</h2><p>only one survived the redesign here</p><span>tools</span><div><span>1M</span><span>Pulls</span></div></li>'
      : RETIREMENT_HTML);
    const shrunk = await lib.refresh({ fetchText: collapsed, now: new Date('2026-09-08T11:00:00Z') });
    check('a collapsed parse is treated as failure, not as a shrunken library',
      shrunk.library.ok === false, JSON.stringify(shrunk.library));
    check('the collapse is explained with both counts',
      /only 1 of 4 known families/.test(shrunk.library.reason || ''), shrunk.library.reason);
    check('the full catalogue is still intact',
      Object.keys(cat.loadCatalog({}).catalog).length === 4);

    // The two documents must fail INDEPENDENTLY.
    const halfDown = async (url) => {
      if (url === lib.RETIREMENT_URL) throw new Error('ETIMEDOUT');
      return LIBRARY_HTML;
    };
    const half = await lib.refresh({ fetchText: halfDown, now: new Date('2026-09-09T10:00:00Z') });
    check('the library still updates when the docs page is down', half.library.ok === true);
    check('the failure of one half is reported', /ETIMEDOUT/.test(half.retirements.reason || ''));
    check('a half-success still saves', half.saved === true);
    check('the cached schedule is preserved through a docs outage',
      cat.loadCatalog({}).schedule.length === 4);

    check('refresh without a fetcher is refused rather than throwing',
      (await lib.refresh({})).ok === false);

    cat.useStore(null);
  }

  // ── 5. migrationPlan — deprecation that names what to do ───────────────────
  console.log('\n  migration off retired models');
  {
    const now = new Date('2026-09-07');
    const schedule = lib.parseRetirements(RETIREMENT_HTML);
    const library = lib.parseLibrary(LIBRARY_HTML);

    const installed = cat.describeInstalled({
      tags: [
        { name: 'qwen3-coder:480b', size: 35 * 1024 * 1024 },
        { name: 'minimax-m2.5:latest', size: 30 * 1024 * 1024 },
        { name: 'gemma4:12b', size: 8 * 1024 * 1024 * 1024 },
      ],
      catalog: library, schedule, now,
    });

    const plan = cat.migrationPlan({ installed, catalog: library, schedule, now });

    check('only affected models appear in the plan', plan.length === 2, String(plan.length));
    check('a healthy model is absent', !plan.some(p => /gemma4/.test(p.model)));

    // Broken now must sort above breaking later.
    check('an already-retired model is first', plan[0].retired === true);
    check('it is critical', plan[0].severity === 'critical');
    check('it names Ollama\'s replacement', plan[0].replacement === 'qwen3.5:397b');
    check('the source of that advice is attributed to Ollama',
      plan[0].replacementSource === 'ollama');
    // The fix must be copyable, not described.
    check('the action is a runnable command', plan[0].action === 'ollama pull qwen3.5:397b',
      plan[0].action);

    // A row still filed under "Upcoming retirements" whose date has since PASSED must read as
    // retired. The heading is stale; the date is not. Getting this backwards would tell master he
    // has time to migrate when the model is already gone.
    const lapsed = plan.find(p => /minimax/.test(p.model));
    check('an "upcoming" row whose date has passed is treated as retired',
      lapsed.retired === true && lapsed.severity === 'critical', JSON.stringify(lapsed));
    check('it carries the date', lapsed.date === '2026-07-31');
    check('it names its replacement', lapsed.replacement === 'minimax-m2.7');

    // And a genuinely future date must read as a warning, not a failure.
    const early = cat.migrationPlan({
      installed: cat.describeInstalled({
        tags: [{ name: 'minimax-m2.5:latest', size: 30 * 1024 * 1024 }],
        catalog: library, schedule, now: new Date('2026-06-01'),
      }),
      catalog: library, schedule, now: new Date('2026-06-01'),
    });
    check('a genuinely future retirement is a warning', early[0].severity === 'warn',
      JSON.stringify(early[0]));
    check('and tells master to move before the date',
      /Move to minimax-m2\.7 before then/.test(early[0].why), early[0].why);
  }

  // ── 5b. Already-installed replacement, and the stranded case ───────────────
  console.log('\n  the two cases that are easy to get wrong');
  {
    const now = new Date('2026-09-07');
    const library = lib.parseLibrary(LIBRARY_HTML);

    // Master already has the replacement: telling him to download it would be noise.
    const schedule = [{ model: 'gemma3:27b', alternative: 'gemma4:31b', date: '2026-07-15', past: true }];
    const installed = cat.describeInstalled({
      tags: [
        { name: 'gemma3:27b', size: 16 * 1024 * 1024 * 1024 },
        { name: 'gemma4:31b', size: 19 * 1024 * 1024 * 1024 },
      ],
      catalog: library, schedule, now,
    });
    const plan = cat.migrationPlan({ installed, catalog: library, schedule, now });
    const row = plan.find(p => /gemma3/.test(p.model));

    check('an already-installed replacement is recognised', row.alreadyInstalled === true);
    check('the action is to stop using the old one, not to pull',
      /Stop using/.test(row.action) && !/pull/.test(row.action), row.action);

    // No alternative named: master must not be left stranded.
    const orphan = [{ model: 'oldthing', alternative: null, date: '2026-07-15', past: true }];
    const inst2 = cat.describeInstalled({
      tags: [{ name: 'oldthing:7b', size: 4 * 1024 * 1024 * 1024 }],
      catalog: library, schedule: orphan, now,
    });
    const plan2 = cat.migrationPlan({ installed: inst2, catalog: library, schedule: orphan, now });

    check('a retirement with no named alternative still gets a substitute',
      !!plan2[0].replacement, JSON.stringify(plan2[0]));
    // Attribution matters: "Ollama says use this" and "Rāma picked this" are different claims.
    check('the substitute is attributed to Rāma, not to Ollama',
      plan2[0].replacementSource === 'rama-scored');
    check('the substitute carries the scoring reasons',
      Array.isArray(plan2[0].replacementWhy) && plan2[0].replacementWhy.length > 0);
    check('and a runnable command', /^ollama pull /.test(plan2[0].action));
  }

  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})();
