'use strict';

/**
 * verifyOllamaCatalog.cjs — discovery, honest cloud classification, retirement (Section 92).
 *
 * The dangerous failure here is NOT a crash. It is telling master a cloud call was local — he would
 * believe his prompt stayed on the machine when it went to Ollama's servers. So the assertions lean
 * hard on classification never overstating privacy, and on `unknown` never collapsing into `local`.
 *
 * Fixtures use the real shapes: `/api/tags` entries as Ollama returns them, and retirement rows as
 * published in Ollama's cloud docs.
 *
 * Run: node scripts/verifyOllamaCatalog.cjs   (or npm run verify:ollama)
 */

const cat = require('../electron/lib/ollamaCatalog.cjs');

let pass = 0;
let fail = 0;

function check(label, ok, detail) {
  if (ok) { pass += 1; console.log(`  PASS  ${label}`); }
  else { fail += 1; console.log(`  FAIL  ${label}${detail ? ` - ${detail}` : ''}`); }
}

const GB = 1024 * 1024 * 1024;
const MB = 1024 * 1024;

// Real rows from Ollama's published schedule.
const SCHEDULE = [
  { model: 'minimax-m2.5', alternative: 'minimax-m2.7', date: '2026-07-31' },
  { model: 'kimi-k2.5', alternative: 'kimi-k2.6', date: '2026-07-31' },
  { model: 'qwen3-coder:480b', alternative: 'qwen3.5:397b', date: '2026-07-15', past: true },
  { model: 'gemma3:27b', alternative: 'gemma4:31b', date: '2026-07-15', past: true },
  { model: 'deepseek-v3.1:671b', alternative: 'deepseek-v4-flash', date: '2026-07-15', past: true },
];

const CATALOG = {
  'qwen3.5': { cloud: false, tools: true, thinking: true, vision: true, pulls: 19700000, sizes: ['0.8b', '9b', '27b'], description: 'Multimodal family' },
  'glm-5.3': { cloud: true, tools: true, thinking: true, vision: true, pulls: 35400, description: 'Z.ai flagship' },
  'kimi-k3': { cloud: true, tools: true, thinking: true, vision: true, pulls: 73800, description: 'Agentic multimodal' },
  'muse-glimmer': { cloud: false, tools: true, thinking: true, vision: true, pulls: 191800, sizes: ['30b'], description: 'Local agents' },
  'embeddinggemma': { cloud: false, tools: false, thinking: false, vision: false, pulls: 2000000, sizes: ['300m'] },
  'gemma4': { cloud: false, tools: true, thinking: true, vision: true, pulls: 24300000, sizes: ['12b', '31b'] },
};

const SEED = {
  'ollama/llama3.2': { ctxK: 128, costTier: 0, caps: ['general', 'offline'] },
  'ollama/codellama': { ctxK: 16, costTier: 0, caps: ['code', 'offline'] },
};

(async () => {
  console.log('\nollamaCatalog — discovery, honest classification, retirement\n');

  // ── 1. Classification, and what it is allowed to claim ─────────────────────
  console.log('  classification');
  {
    const byCatalog = cat.classify({ name: 'glm-5.3:latest', size: 40 * MB }, CATALOG['glm-5.3']);
    check('the catalogue is trusted first', byCatalog.cloud === true && byCatalog.evidence === 'catalog');

    const localByCatalog = cat.classify({ name: 'qwen3.5:9b', size: 6 * GB }, CATALOG['qwen3.5']);
    check('a catalogued local model is local', localByCatalog.cloud === false);

    const byName = cat.classify({ name: 'gpt-oss:120b-cloud', size: 30 * MB }, null);
    check('an explicit cloud marker in the name is honoured',
      byName.cloud === true && byName.evidence === 'name');

    // The size test: 397B of weights cannot be running from 40 MB on disk.
    const bySize = cat.classify({ name: 'qwen3.5:397b', size: 40 * MB }, null);
    check('a huge model with almost no disk is cloud', bySize.cloud === true && bySize.evidence === 'size');
    check('the size verdict explains itself in master\'s terms',
      /weights are not here/.test(bySize.why), bySize.why);

    const realLocal = cat.classify({ name: 'muse-glimmer:30b', size: 18 * GB }, null);
    check('a big model with big weights on disk is local', realLocal.cloud === false);

    // A 300M embedding model is legitimately ~200MB. The size test must not fire.
    const small = cat.classify({ name: 'embeddinggemma:300m', size: 200 * MB }, null);
    check('a genuinely small model is NOT called cloud', small.cloud !== true,
      JSON.stringify(small));

    const noInfo = cat.classify({ name: 'mystery:latest' }, null);
    check('with no evidence the answer is unknown', noInfo.cloud === null);
    // THE ASYMMETRIC FAILURE: unknown must never be reported as local.
    check('unknown is never silently local', noInfo.cloud !== false, JSON.stringify(noInfo));
    check('unknown says why it could not decide', /not conclusive/.test(noInfo.why));
  }

  // ── 2. Parameter parsing, including MoE ────────────────────────────────────
  console.log('\n  size parsing');
  {
    check('27b', cat.paramsB('qwen3.5:27b') === 27);
    check('0.8b', cat.paramsB('qwen3.5:0.8b') === 0.8);
    check('397b', cat.paramsB('qwen3.5:397b') === 397);
    check('350m becomes 0.35', cat.paramsB('granite4:350m') === 0.35);
    // MoE read as TOTAL, because total is what would have to sit on disk — the actual question.
    check('16x17b is read as its 272B total', cat.paramsB('llama4:16x17b') === 272);
    check('a bare name yields null', cat.paramsB('mistral') === null);
    check('a non-size tag yields null', cat.paramsB('qwen3.5:latest') === null);
  }

  // ── 3. Retirement — defect C, the one the docs revealed ────────────────────
  console.log('\n  retirement awareness');
  {
    const now = new Date('2026-09-07');

    const retired = cat.retirementFor('qwen3-coder:480b', SCHEDULE, now);
    check('an exactly-listed retired model is found', !!retired && retired.retired === true);
    check('it names Ollama\'s recommended replacement',
      retired.alternative === 'qwen3.5:397b', retired?.alternative);

    // The schedule lists a bare family; master runs a tagged variant of it.
    const family = cat.retirementFor('minimax-m2.5:latest', SCHEDULE, now);
    check('a family-level row matches a tagged install', !!family, JSON.stringify(family));
    check('a date already past is reported as retired, not upcoming',
      family.retired === true, JSON.stringify(family));

    // A future date must read as a warning, not as already broken.
    const future = cat.retirementFor('kimi-k2.5', SCHEDULE, new Date('2026-01-01'));
    check('a future retirement is a warning, not a failure', future.retired === false);
    check('the upcoming note tells master to move in time',
      /Move to kimi-k2\.6 before then/.test(future.note), future.note);

    check('an unaffected model returns null',
      cat.retirementFor('qwen3.5:9b', SCHEDULE, now) === null);
    check('an empty schedule never invents a retirement',
      cat.retirementFor('anything:1b', [], now) === null);
  }

  // ── 4. describeInstalled — discovery replacing the allowlist ───────────────
  console.log('\n  discovery and description');
  {
    const tags = [
      { name: 'qwen3.5:9b', size: 6 * GB },
      { name: 'glm-5.3:latest', size: 40 * MB },
      { name: 'qwen3-coder:480b', size: 35 * MB },
      { name: 'mystery:latest' },
    ];
    const models = cat.describeInstalled({ tags, catalog: CATALOG, schedule: SCHEDULE, seed: SEED, now: new Date('2026-09-07') });
    const by = (id) => models.find(m => m.id === id);

    // DEFECT A: a model outside the old four-name allowlist must now be present and routable.
    check('a pulled model outside the old allowlist is described',
      !!by('ollama/qwen3.5:9b'));
    check('every discovered model is marked discovered',
      models.every(m => m.discovered === true));
    check('all four tags produced entries', models.length === 4, String(models.length));

    // DEFECT B: the honesty assertions.
    const cloud = by('ollama/glm-5.3:latest');
    check('a cloud model is typed cloud-ollama', cloud.type === 'cloud-ollama');
    check('a cloud model is NOT marked private', cloud.private === false);
    check('a cloud model does NOT claim offline', !cloud.caps.includes('offline'),
      JSON.stringify(cloud.caps));
    check('a cloud model is marked remote', cloud.caps.includes('remote'));
    check('a cloud model is not costTier 0 — the free allowance is a real budget',
      cloud.costTier !== 0, String(cloud.costTier));
    check('a cloud model carries the evidence for that call',
      cloud.cloudEvidence === 'catalog' && typeof cloud.cloudWhy === 'string');

    const local = by('ollama/qwen3.5:9b');
    check('a local model IS marked private', local.private === true);
    check('a local model claims offline', local.caps.includes('offline'));
    check('a local model is free', local.costTier === 0);
    check('vision from the catalogue is carried through', local.caps.includes('vision'));

    const unknown = by('ollama/mystery:latest');
    check('an unclassifiable model is typed unknown', unknown.type === 'unknown');
    check('an unknown model does NOT claim to be private', unknown.private === false);
    check('an unknown model claims neither offline nor remote',
      !unknown.caps.includes('offline') && !unknown.caps.includes('remote'),
      JSON.stringify(unknown.caps));

    // Context is inherited from the seed but must not be presented as measured, because Ollama
    // truncates to num_ctx regardless of what the family supports.
    check('context length is marked unverified', models.every(m => m.ctxVerified === false));

    // A retired model must be flagged on the entry itself, not only in a separate report.
    check('a retired install carries its retirement', !!by('ollama/qwen3-coder:480b').retirement);
  }

  // ── 5. Advisories — what master is told without having to ask ──────────────
  console.log('\n  advisories');
  {
    const tags = [
      { name: 'qwen3-coder:480b', size: 35 * MB },
      { name: 'kimi-k2.5:latest', size: 30 * MB },
      { name: 'qwen3.5:9b', size: 6 * GB },
    ];
    const models = cat.describeInstalled({ tags, catalog: CATALOG, schedule: SCHEDULE, now: new Date('2026-06-01') });
    const adv = cat.advisories(models);

    check('only affected models produce advisories', adv.length === 2, String(adv.length));
    check('an already-retired model is critical',
      adv.find(a => a.id.includes('qwen3-coder')).severity === 'critical');
    check('an upcoming retirement is a warning',
      adv.find(a => a.id.includes('kimi-k2.5')).severity === 'warn');
    check('each advisory names the replacement',
      adv.every(a => typeof a.alternative === 'string' && a.alternative.length > 0));
    check('a healthy model produces no advisory',
      !adv.some(a => a.id.includes('qwen3.5:9b')));
  }

  // ── 6. Curation — a judgement, not a listing ───────────────────────────────
  console.log('\n  curation and scoring');
  {
    const installed = [{ model: 'qwen3.5:9b' }];
    const now = new Date('2026-09-07');

    const { recommended, excluded } = cat.suggestions({ catalog: CATALOG, installed, now, schedule: SCHEDULE });

    check('a model already installed is not suggested',
      !recommended.some(r => r.family === 'qwen3.5'));
    check('the shortlist is short — a curation, not a catalogue',
      recommended.length <= 5, String(recommended.length));
    check('every recommendation explains its score',
      recommended.every(r => Array.isArray(r.why) && r.why.length > 0));
    check('every recommendation carries a numeric score',
      recommended.every(r => Number.isFinite(r.score)));

    // HARD EXCLUSION, not a penalty: Rāma drives an agent loop and cannot act without tool calling.
    check('a model without tool calling is EXCLUDED, not merely ranked low',
      !recommended.some(r => r.family === 'embeddinggemma')
      && excluded.some(e => e.family === 'embeddinggemma'),
      JSON.stringify(excluded));
    check('the exclusion says why in master\'s terms',
      /could not act/.test(excluded.find(e => e.family === 'embeddinggemma').reason));
    // Rejections are returned rather than silently omitted, so an absence is explainable.
    check('exclusions are reported rather than hidden', Array.isArray(excluded));

    check('master\'s disk constraint puts cloud on top',
      recommended[0].cloud === true, JSON.stringify(recommended[0]));
    check('the top pick names disk as a reason',
      recommended[0].why.some(w => /no disk/.test(w)), JSON.stringify(recommended[0].why));
  }

  // ── 6b. THE CORRECTION: popularity is a rate, not a total ──────────────────
  // Pull counts accumulate for as long as a model exists, so ranking by them ranks by AGE. The first
  // implementation did exactly that, which would recommend a year-old superseded model over a
  // purpose-built one released last week.
  console.log('\n  popularity is measured as a rate, not a total');
  {
    const c = {
      // Huge total, but a year old and accumulating slowly now.
      'llama3.1': { cloud: false, tools: true, thinking: false, pulls: 119200000, updatedDaysAgo: 400, sizes: ['8b'] },
      // Small total, one week old, purpose-built for local agents.
      'muse-glimmer': { cloud: false, tools: true, thinking: true, pulls: 191800, updatedDaysAgo: 7, sizes: ['30b'], description: 'Apache 2.0, local agents' },
    };
    const { recommended } = cat.suggestions({ catalog: c, preferCloud: false, now: new Date('2026-09-07') });

    check('the fresh purpose-built model outranks the old popular one',
      recommended[0].family === 'muse-glimmer',
      JSON.stringify(recommended.map(r => [r.family, r.score])));
    check('a model over a year old is penalised for being superseded',
      recommended.find(r => r.family === 'llama3.1').why.some(w => /superseded/.test(w)));
    check('the reason cites an adoption RATE, not a total',
      recommended[0].why.some(w => /pulls a month/.test(w)), JSON.stringify(recommended[0].why));
    check('a permissive licence is credited',
      recommended[0].why.some(w => /permissively licensed/.test(w)));
  }

  // ── 6c. Disk budget, master's actual constraint ────────────────────────────
  console.log('\n  disk budget');
  {
    const c = {
      small: { cloud: false, tools: true, thinking: true, pulls: 100000, updatedDaysAgo: 10, sizes: ['4b'] },
      huge: { cloud: false, tools: true, thinking: true, pulls: 100000, updatedDaysAgo: 10, sizes: ['70b'] },
    };
    const budget = 8 * GB;
    const { recommended } = cat.suggestions({ catalog: c, preferCloud: false, diskBudgetBytes: budget, now: new Date() });

    check('a model that fits the budget outranks one that does not',
      recommended[0].family === 'small',
      JSON.stringify(recommended.map(r => [r.family, r.score])));
    // Not excluded: master may free space or accept the cost. It just must not outrank a fit.
    check('an oversized model is penalised, not excluded',
      recommended.some(r => r.family === 'huge'));
    check('the penalty states the size and the budget breach',
      recommended.find(r => r.family === 'huge').why.some(w => /over the budget/.test(w)));
    check('a fitting local model is credited for privacy and offline use',
      recommended[0].why.some(w => /keeps prompts on this machine/.test(w)));

    check('q4Bytes estimates ~0.6GB per billion params',
      Math.round(cat.q4Bytes(10) / GB) === 6, String(cat.q4Bytes(10) / GB));
    check('smallestSizeB picks the smallest advertised build',
      cat.smallestSizeB(['27b', '4b', '9b']) === 4);
    check('smallestSizeB tolerates no sizes', cat.smallestSizeB([]) === null);
  }

  // ── 6d. A retired model is never recommended at any rank ───────────────────
  console.log('\n  retired models are never recommended');
  {
    const c = {
      'kimi-k2.5': { cloud: true, tools: true, thinking: true, pulls: 9000000, updatedDaysAgo: 5 },
      'kimi-k3': { cloud: true, tools: true, thinking: true, pulls: 73800, updatedDaysAgo: 30 },
    };
    const { recommended, excluded } = cat.suggestions({
      catalog: c, schedule: SCHEDULE, now: new Date('2026-09-07'),
    });

    check('a retired model is excluded despite huge adoption',
      !recommended.some(r => r.family === 'kimi-k2.5'),
      JSON.stringify(recommended.map(r => r.family)));
    check('its exclusion names the replacement Ollama recommends',
      /kimi-k2\.6/.test(excluded.find(e => e.family === 'kimi-k2.5').reason),
      JSON.stringify(excluded));
    check('the healthy sibling is still recommended',
      recommended.some(r => r.family === 'kimi-k3'));
  }

  // ── 6e. Persistence — the store IS the database ─────────────────────────────
  console.log('\n  cached as an integrated resource');
  {
    const mem = new Map();
    let saved = 0;
    cat.useStore({
      get: (d, k) => mem.get(`${d}:${k}`),
      set: (d, k, v) => mem.set(`${d}:${k}`, v),
      saveDomain: () => { saved += 1; },
    });

    const fresh = cat.loadCatalog({ now: new Date() });
    check('an empty store loads as empty rather than throwing', fresh.empty === true);
    check('never-fetched counts as stale', fresh.stale === true);
    check('an empty load still returns usable structures',
      typeof fresh.catalog === 'object' && Array.isArray(fresh.schedule));

    const t0 = new Date('2026-09-07T10:00:00Z');
    cat.saveCatalog({ catalog: CATALOG, schedule: SCHEDULE, source: 'ollama.com/library', now: t0 });
    check('saving persists the domain', saved === 1);

    const hot = cat.loadCatalog({ now: new Date('2026-09-07T11:00:00Z') });
    check('a just-fetched catalogue is not stale', hot.stale === false);
    check('the catalogue round-trips', hot.catalog['glm-5.3'].cloud === true);
    check('the retirement schedule round-trips', hot.schedule.length === SCHEDULE.length);
    check('the source is recorded so master knows where it came from',
      hot.source === 'ollama.com/library');
    check('age is measured from the recorded fetch time', hot.ageMs === 60 * 60 * 1000);

    const old = cat.loadCatalog({ now: new Date('2026-09-09T11:00:00Z') });
    check('a two-day-old catalogue is stale', old.stale === true);
    // Stale is advice, not refusal — a day-old catalogue beats none when the network is down.
    check('a stale catalogue is still returned and usable',
      Object.keys(old.catalog).length > 0 && old.empty === false);

    // The offline case this cache exists for: warning master about a retirement with no network.
    const offlineAdvice = cat.retirementFor('kimi-k2.5', old.schedule, new Date('2026-09-09'));
    check('retirement can be answered offline from the cache',
      !!offlineAdvice && offlineAdvice.retired === true);

    mem.set('config:ollamaCatalog', { catalog: 'not-an-object', schedule: 'nope', fetchedAt: 'rubbish' });
    const junk = cat.loadCatalog({ now: new Date() });
    check('a corrupt cached document degrades to empty rather than throwing',
      junk.empty === true && Array.isArray(junk.schedule) && junk.stale === true);

    cat.useStore(null);
  }

  // ── 7. Robustness — a daemon returning junk must not throw ─────────────────
  console.log('\n  hostile input');
  {
    check('no tags at all yields no models',
      cat.describeInstalled({}).length === 0);
    check('a nameless tag is skipped rather than described',
      cat.describeInstalled({ tags: [{ size: 5 }, { name: '' }] }).length === 0);
    check('a non-numeric size does not throw',
      cat.describeInstalled({ tags: [{ name: 'x:9b', size: 'huge' }] })[0].sizeBytes === null);
    check('classify tolerates being called with nothing',
      cat.classify().cloud === null);
    check('familyOf tolerates undefined', cat.familyOf() === '');
  }

  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})();
