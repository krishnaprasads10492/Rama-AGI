'use strict';

/**
 * intelligenceEngine.cjs — Universal Intelligence & Prediction Engine.
 *
 * NOT just stocks. Prediction about ANYTHING with truth extraction.
 *
 * Pipeline:
 *   1. Query decomposition — break complex question into sub-queries
 *   2. Human-emulated multi-source gathering (browser + API fallback)
 *   3. Source vetting — credibility scoring, bias detection
 *   4. Cross-reference — find agreements AND contradictions across sources
 *   5. Attribution — every finding classified by electron/lib/claimGate.cjs
 *   6. Output — a claim CLASS, the source map, and the contradictions said out loud
 *
 * THE NUMBER THIS FILE USED TO EMIT, AND WHY IT IS GONE (Sections 110/111). `buildOutput` shipped
 * `overallConfidence: 78.4`, a letter `grade`, and "78.4% means ~21.6% chance of being wrong". All
 * three came out of `extractTruth`, which averaged DOMAIN REPUTATION and added a bonus per keyword
 * bigram shared by two documents. **Nothing in it measured whether a finding answered the question**,
 * so five reputable domains about something else still graded A: a calibrated-looking number with no
 * calibration behind it, which is the "emitted as if grounded" failure with extra decimals.
 *
 * It is replaced by claimGate's OWN classes — grounded / reflex / prose / unattributed — the
 * per-source map that was always here, and contradictions stated plainly instead of folded into a
 * penalty term on a score. A CLASS IS NOT A SCORE: there is no ordering to read off it and no
 * percentage to quote, and `verifyClaimGate.cjs` asserts this file computes no score shape at all,
 * so the number cannot be reintroduced quietly.
 *
 * Human emulation to bypass AI gates:
 *   - Randomized realistic user agents (Chrome/Firefox/Safari on Win/Mac/Linux)
 *   - Random delays between requests (human typing/reading cadence)
 *   - Referrer chain simulation
 *   - Viewport + timezone spoofing
 *   - Accept-Language headers matching UA
 *   - Cookie + session persistence per domain
 *   - Scroll/mouse simulation via Playwright
 */

const crypto    = require('crypto');
const net       = require('../lib/http.cjs');
const claimGate = require('../lib/claimGate.cjs');

/** How much of a source is quoted back as a finding. Cut at a word boundary — see `excerpt`. */
const FINDING_CHARS = 200;

// ─── Human emulation profiles ─────────────────────────────────────────────────
const HUMAN_PROFILES = [
  {
    ua:       'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    platform: 'Win32', lang: 'en-US,en;q=0.9', vendor: 'Google Inc.',
    viewport: { width: 1920, height: 1080 },
  },
  {
    ua:       'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    platform: 'MacIntel', lang: 'en-US,en;q=0.9', vendor: 'Google Inc.',
    viewport: { width: 1440, height: 900 },
  },
  {
    ua:       'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
    platform: 'Win32', lang: 'en-US,en;q=0.5', vendor: '',
    viewport: { width: 1366, height: 768 },
  },
  {
    ua:       'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
    platform: 'MacIntel', lang: 'en-US,en;q=0.9', vendor: 'Apple Computer, Inc.',
    viewport: { width: 1440, height: 900 },
  },
  {
    ua:       'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    platform: 'Linux x86_64', lang: 'en-US,en;q=0.9', vendor: 'Google Inc.',
    viewport: { width: 1920, height: 1080 },
  },
];

// ─── Source credibility database ──────────────────────────────────────────────
const SOURCE_CREDIBILITY = {
  // Financial / Market
  'reuters.com':          { score: 0.95, bias: 'center',       type: 'financial-news'    },
  'bloomberg.com':        { score: 0.93, bias: 'center',       type: 'financial-news'    },
  'wsj.com':              { score: 0.90, bias: 'center-right', type: 'financial-news'    },
  'ft.com':               { score: 0.92, bias: 'center',       type: 'financial-news'    },
  'cnbc.com':             { score: 0.82, bias: 'center',       type: 'financial-news'    },
  'marketwatch.com':      { score: 0.80, bias: 'center',       type: 'financial-news'    },
  'investing.com':        { score: 0.78, bias: 'neutral',      type: 'market-data'       },
  'finance.yahoo.com':    { score: 0.80, bias: 'neutral',      type: 'market-data'       },
  // General news
  'apnews.com':           { score: 0.96, bias: 'center',       type: 'general-news'      },
  'bbc.com':              { score: 0.92, bias: 'center-left',  type: 'general-news'      },
  'theguardian.com':      { score: 0.85, bias: 'center-left',  type: 'general-news'      },
  'nytimes.com':          { score: 0.88, bias: 'center-left',  type: 'general-news'      },
  'economist.com':        { score: 0.91, bias: 'center',       type: 'general-news'      },
  // Science / Tech
  'nature.com':           { score: 0.98, bias: 'neutral',      type: 'science'           },
  'arxiv.org':            { score: 0.90, bias: 'neutral',      type: 'preprint'          },
  'sciencedirect.com':    { score: 0.95, bias: 'neutral',      type: 'science'           },
  'techcrunch.com':       { score: 0.75, bias: 'neutral',      type: 'tech-news'         },
  // India specific
  'moneycontrol.com':     { score: 0.82, bias: 'center',       type: 'india-finance'     },
  'economictimes.com':    { score: 0.83, bias: 'center',       type: 'india-finance'     },
  'livemint.com':         { score: 0.83, bias: 'center',       type: 'india-finance'     },
  'ndtv.com':             { score: 0.80, bias: 'center',       type: 'india-news'        },
  'thehindu.com':         { score: 0.85, bias: 'center-left',  type: 'india-news'        },
  // Default for unknown domains
  '_default':             { score: 0.50, bias: 'unknown',      type: 'unknown'           },
};

// ─── Active intelligence sessions ─────────────────────────────────────────────
const sessions = {};

// ─── Register IPC ─────────────────────────────────────────────────────────────
function register(ipcMain) {

  // ── Run full intelligence pipeline ────────────────────────────────────────
  ipcMain.handle('intel:analyze', async (event, { query, depth = 'standard', category = 'general' }) => {
    const sessionId = crypto.randomBytes(8).toString('hex');
    const session   = {
      id:       sessionId,
      query,
      depth,
      category,
      status:   'running',
      startedAt: Date.now(),
      steps:    [],
      sources:  [],
      result:   null,
    };
    sessions[sessionId] = session;

    const emit = (step, data) => {
      session.steps.push({ step, data, ts: Date.now() });
      event.sender.send('intel:progress', { sessionId, step, data });
    };

    try {
      // Step 1: Decompose query
      emit('decompose', { message: 'Decomposing query into sub-questions...' });
      const subQueries = decomposeQuery(query, category);
      emit('decompose', { subQueries });

      // Step 2: Gather from multiple sources
      emit('gather', { message: `Gathering from ${subQueries.length * 3} source queries...` });
      const rawSources = await gatherSources(subQueries, category, (progress) => {
        event.sender.send('intel:progress', { sessionId, step: 'gather', data: progress });
      });
      emit('gather', { count: rawSources.length, sources: rawSources.map(s => s.domain) });

      // Step 3: Vet sources
      emit('vet', { message: 'Vetting source credibility...' });
      const vettedSources = vetSources(rawSources);
      session.sources = vettedSources;
      emit('vet', { retained: vettedSources.length, dropped: rawSources.length - vettedSources.length });

      // Step 4: Cross-reference
      emit('crossref', { message: 'Cross-referencing for contradictions...' });
      const crossRef = crossReference(vettedSources, query);
      emit('crossref', { agreements: crossRef.agreements.length, contradictions: crossRef.contradictions.length });

      // Step 5: Attribution — which findings a supplied source actually carries
      emit('extract', { message: 'Checking each finding against the source it came from...' });
      const truth = extractTruth(vettedSources, crossRef, query);
      emit('extract', { claimClass: truth.claimClass, withheld: truth.attribution.withheld.length });

      // Step 6: Build calibrated output
      const result = buildOutput(query, truth, vettedSources, crossRef, category);
      session.result = result;
      session.status = 'complete';

      event.sender.send('intel:complete', { sessionId, result });
      return { ok: true, sessionId, result };

    } catch (err) {
      session.status = 'error';
      session.error  = err.message;
      return { ok: false, sessionId, error: err.message };
    }
  });

  // ── Get session status ────────────────────────────────────────────────────
  ipcMain.handle('intel:get-session', async (_e, sessionId) => {
    const session = sessions[sessionId];
    if (!session) return { ok: false, error: 'Session not found' };
    return { ok: true, data: session };
  });

  // ── List recent sessions ──────────────────────────────────────────────────
  ipcMain.handle('intel:list-sessions', async () => {
    const list = Object.values(sessions)
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, 20)
      .map(s => ({
        id:       s.id,
        query:    s.query,
        status:   s.status,
        category: s.category,
        // The history row carries the same class as the result it summarises. It used to carry the
        // percentage, which made a list of past answers read as a list of scores.
        claimClass: s.result?.claimClass ?? null,
        startedAt: s.startedAt,
      }));
    return { ok: true, data: list };
  });

  // ── Quick source check ────────────────────────────────────────────────────
  ipcMain.handle('intel:check-source', async (_e, domain) => {
    const cred = getSourceCredibility(domain);
    return { ok: true, data: cred };
  });
}

// ─── Query decomposition ──────────────────────────────────────────────────────
function decomposeQuery(query, category) {
  const q = query.toLowerCase();
  const base = [query];

  // Add dimension-specific sub-queries
  if (category === 'financial' || q.includes('stock') || q.includes('price') || q.includes('market')) {
    base.push(
      `${query} latest news`,
      `${query} analyst forecast`,
      `${query} technical analysis`,
      `${query} fundamental analysis`,
      `${query} earnings revenue`,
    );
  } else if (category === 'political' || q.includes('election') || q.includes('policy') || q.includes('government')) {
    base.push(
      `${query} latest news`,
      `${query} expert opinion`,
      `${query} poll data`,
      `${query} historical precedent`,
    );
  } else if (category === 'scientific' || q.includes('research') || q.includes('study') || q.includes('science')) {
    base.push(
      `${query} peer reviewed research`,
      `${query} scientific consensus`,
      `${query} recent studies 2024 2025`,
    );
  } else if (category === 'sports' || q.includes('match') || q.includes('team') || q.includes('player')) {
    base.push(
      `${query} statistics`,
      `${query} form guide`,
      `${query} expert prediction`,
    );
  } else {
    base.push(
      `${query} latest`,
      `${query} expert analysis`,
      `${query} evidence`,
    );
  }

  return [...new Set(base)].slice(0, 6);
}

// ─── Multi-source gathering with human emulation ───────────────────────────────
async function gatherSources(subQueries, category, onProgress) {
  const results = [];
  const profile = HUMAN_PROFILES[Math.floor(Math.random() * HUMAN_PROFILES.length)];

  let done = 0;
  for (const q of subQueries) {
    // Human-like delay between searches (1-3 seconds)
    await humanDelay(1000, 3000);

    try {
      const sources = await searchWithHumanEmulation(q, profile);
      results.push(...sources);
      done++;
      onProgress?.({ done, total: subQueries.length, query: q });
    } catch (err) {
      // Silently skip failed queries — we have other sources
    }
  }

  return deduplicateSources(results);
}

// ─── Human-emulated search ────────────────────────────────────────────────────
async function searchWithHumanEmulation(query, profile) {
  // Try DuckDuckGo JSON API first (most permissive)
  const ddgResults = await fetchDDGAPI(query, profile);
  if (ddgResults.length > 0) return ddgResults;

  // Fallback: construct results from URL pattern
  return buildFallbackResults(query);
}

/**
 * DuckDuckGo instant-answer API via the shared main-process HTTP client.
 * `getJsonHuman` applies a rotating browser profile (UA / Accept-Language /
 * Sec-Fetch headers) so the request looks like a person's browser — the
 * gate-respecting behaviour the spec requires.
 * Never throws: one failed search must not abort the intelligence pipeline.
 */
async function fetchDDGAPI(query, profile) {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}`
            + `&format=json&no_html=1&skip_disambig=1`;

  const headers = profile
    ? { 'User-Agent': profile.ua, 'Accept-Language': profile.lang }
    : {};

  const parsed = await net.getJsonHuman(url, { headers, timeout: 10000, retries: 1 });
  if (!parsed || parsed.error) return [];

  const results = [];

  // Abstract (main result)
  if (parsed.Abstract) {
    results.push({
      domain:  extractDomain(parsed.AbstractURL || parsed.AbstractSource),
      url:     parsed.AbstractURL,
      title:   parsed.Heading,
      content: parsed.Abstract,
      source:  parsed.AbstractSource,
    });
  }

  // Related topics
  if (Array.isArray(parsed.RelatedTopics)) {
    for (const t of parsed.RelatedTopics.slice(0, 8)) {
      if (t.Text && t.FirstURL) {
        results.push({
          domain:  extractDomain(t.FirstURL),
          url:     t.FirstURL,
          title:   t.Text.split(' - ')[0],
          content: t.Text,
          source:  extractDomain(t.FirstURL),
        });
      }
    }
  }

  return results;
}

/**
 * A marker that every live search failed. NOT a source (Section 94).
 *
 * WHAT THIS USED TO DO, AND WHY IT WAS THE WORST DEFECT IN THIS FILE. It returned a result with
 * `domain:'internal'` and `content` equal to the query echoed back — and `getSourceCredibility()`
 * scored `internal` at **0.60**, comfortably above `vetSources()`'s 0.40 floor. So a total search
 * failure passed vetting as a legitimate source and flowed into "truth extraction with weighted
 * consensus and confidence scoring".
 *
 * The result was not an error but a **fabrication**: a confident-looking, source-attributed answer
 * whose only input was the question. It carried `fallback: true` and nothing anywhere read that flag.
 *
 * It is kept as a marker so callers can still distinguish "searched and found nothing" from "never
 * searched", but `vetSources()` now drops it, so it can never be weighed as evidence again.
 */
function buildFallbackResults(query) {
  return [{
    domain:   'internal',
    url:      null,
    title:    `No sources found for: ${query}`,
    content:  '',
    source:   'search-failed',
    fallback: true,
  }];
}

// ─── Source vetting ───────────────────────────────────────────────────────────
function vetSources(sources) {
  return sources
    // A search-failure marker is not evidence. Dropped HERE rather than only at the call site, so a
    // future caller cannot reintroduce the fabrication by passing one in (Section 94).
    .filter(s => !s.fallback)
    // Nor is an empty document: a source with no content cannot support or contradict anything, and
    // weighting one lets a credible DOMAIN stand in for actual information.
    .filter(s => typeof s.content === 'string' && s.content.trim().length > 0)
    .map(s => ({ ...s, credibility: getSourceCredibility(s.domain) }))
    .filter(s => s.credibility.score >= 0.40)   // Drop very low credibility
    .sort((a, b) => b.credibility.score - a.credibility.score);
}

function getSourceCredibility(domain) {
  if (!domain || domain === 'internal') {
    return { score: 0.60, bias: 'neutral', type: 'internal' };
  }
  const clean = domain.replace(/^www\./, '').toLowerCase();
  return SOURCE_CREDIBILITY[clean] || SOURCE_CREDIBILITY['_default'];
}

// ─── Cross-reference ──────────────────────────────────────────────────────────
function crossReference(sources, query) {
  const agreements     = [];
  const contradictions = [];

  // Simple keyword-based agreement detection
  // Phase 5: replace with embedding-based semantic similarity
  const contentGroups = {};
  for (const s of sources) {
    const words = extractKeyPhrases(s.content || '');
    for (const phrase of words) {
      if (!contentGroups[phrase]) contentGroups[phrase] = [];
      contentGroups[phrase].push(s.domain);
    }
  }

  for (const [phrase, domains] of Object.entries(contentGroups)) {
    if (domains.length >= 2) {
      agreements.push({ phrase, sources: [...new Set(domains)], count: domains.length });
    }
  }

  // Detect potential contradictions (sources saying opposite things)
  const sentimentMap = {};
  for (const s of sources) {
    const sentiment = roughSentiment(s.content || '');
    if (!sentimentMap[sentiment]) sentimentMap[sentiment] = [];
    sentimentMap[sentiment].push(s.domain);
  }

  if (sentimentMap['positive'] && sentimentMap['negative'] &&
      sentimentMap['positive'].length > 0 && sentimentMap['negative'].length > 0) {
    contradictions.push({
      type:     'sentiment-divergence',
      positive: sentimentMap['positive'],
      negative: sentimentMap['negative'],
      message:  'Sources show divergent sentiment on this topic',
    });
  }

  return { agreements, contradictions };
}

// ─── Attribution ──────────────────────────────────────────────────────────────

/**
 * Quote a source back without inventing anything by cutting it.
 *
 * A blind `slice(0, 200)` can land inside a figure — "1,402.55" becomes "1,402.5", a number the
 * source does not contain — so Rāma's own excerpt would be refused by its own gate, and the refusal
 * would name the SOURCE rather than the truncation that caused it. Cut at the last word boundary
 * instead; a hard cut is kept only when there is no boundary to use, which for prose does not happen.
 */
function excerpt(text, max) {
  const s = String(text ?? '').trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > max / 2 ? cut.slice(0, lastSpace) : cut).trim();
}

/**
 * Classify what the sources actually carry. No score of any kind is produced here.
 *
 * `claimGate` is the single classifier — reused, not re-implemented, because a second opinion about
 * what counts as grounded is how declared policy and enforced policy drift apart. Each finding is
 * cited to the source it was quoted from (`s1`…`sn`, which is exactly how `indexEvidence` ids an
 * unlabelled source array), so a finding whose figures are not in its OWN source is withheld.
 *
 * THE WHOLE ANSWER IS `unattributed` IF ANY FINDING WAS WITHHELD. That is `gate`'s own `ok`
 * discipline rather than a new rule: reporting `grounded` while quietly dropping a sentence would
 * re-create the thing this replaced — a flattering summary over a worse reality.
 */
function extractTruth(sources, crossRef, query) {
  const keyFindings = sources
    .slice(0, 5)
    .map((s, i) => ({
      source:      s.domain,
      credibility: s.credibility.score,
      finding:     excerpt(s.content, FINDING_CHARS),
      bias:        s.credibility.bias,
      cite:        `s${i + 1}`,
    }));

  const checked = claimGate.gate({
    claims:  keyFindings.map(f => ({ text: f.finding, cite: f.cite })),
    sources,
  });

  // Index-aligned: `classifyOne` carries the claim's position, so each finding gets the verdict on
  // itself rather than the verdict on the batch.
  const classOf = new Map();
  for (const c of [...checked.emitted, ...checked.withheld]) classOf.set(c.index, c);

  const findings = keyFindings.map((f, i) => {
    const verdict = classOf.get(i);
    return {
      ...f,
      class:  verdict?.class ?? claimGate.CLASS.UNATTRIBUTED,
      reason: verdict?.reason ?? null,
      detail: verdict?.detail ?? null,
    };
  });

  let claimClass;
  if (!checked.emitted.length || checked.withheld.length) claimClass = claimGate.CLASS.UNATTRIBUTED;
  else if (checked.emitted.some(c => c.class === claimGate.CLASS.GROUNDED)) claimClass = claimGate.CLASS.GROUNDED;
  else claimClass = claimGate.CLASS.PROSE;

  const topAgreements = crossRef.agreements
    .slice()
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)
    .map(a => a.phrase);

  return {
    claimClass,
    keyFindings: findings,
    topAgreements,
    attribution: {
      notice:   checked.notice,
      withheld: checked.withheld.map(w => ({ reason: w.reason, cite: w.cite ?? null, detail: w.detail ?? null })),
      accepted: checked.evidence.accepted,
      grounded: checked.evidence.grounded,
      rejected: checked.evidence.rejected,
    },
  };
}

// ─── Build the output ─────────────────────────────────────────────────────────

/**
 * What master is shown: a class, the sources that produced it, and the disagreements between them.
 *
 * `recommendation` is kept — `ramaEventBus` writes it into vector memory, so dropping the key would
 * silently empty the memory of every past analysis (I11). What it SAYS no longer comes from a score.
 *
 * `suppressed` is likewise kept and now means "nothing here is attributable", which is the condition
 * the renderer should actually warn about. It used to mean `conf < 0.15`, a threshold on the number
 * that is gone.
 */
function buildOutput(query, truth, sources, crossRef, category) {
  return {
    query,
    category,
    timestamp:         Date.now(),
    claimClass:        truth.claimClass,
    // Words, from the gate, naming what was refused and why. Never a figure.
    claimNotice:       truth.attribution.notice,
    withheld:          truth.attribution.withheld,
    sourceCount:       sources.length,
    sourceSummary:     sources.slice(0, 8).map(s => ({
      domain:      s.domain,
      credibility: parseFloat((s.credibility.score * 100).toFixed(0)),
      bias:        s.credibility.bias,
      type:        s.credibility.type,
    })),
    keyFindings:       truth.keyFindings,
    agreements:        crossRef.agreements.slice(0, 10),
    contradictions:    crossRef.contradictions,
    // Stated either way. "No contradiction was detected" and "the sources agree" are different
    // facts, and the old output let the second be inferred from a high grade.
    contradictionNote: describeContradictions(crossRef.contradictions, sources.length),
    topAgreements:     truth.topAgreements,
    recommendation:    buildRecommendation(truth, crossRef, sources.length),
    disclaimer:        'This analysis is generated from publicly available sources. It is informational only. Verify independently before acting on any finding. No guarantees of accuracy.',
    suppressed:        truth.claimClass === claimGate.CLASS.UNATTRIBUTED,
  };
}

function describeContradictions(contradictions, sourceCount) {
  if (contradictions.length) {
    return contradictions.map(c => c.message).join('; ');
  }
  if (!sourceCount) return 'No source survived vetting, so no contradiction could be detected either.';
  return 'No contradiction was detected between these sources, which is not the same as them agreeing.';
}

/**
 * The standing statement about the answer. Derived from the CLASS, so it cannot drift away from what
 * the gate decided — the old version took a number and the prose took a different threshold.
 */
function buildRecommendation(truth, crossRef, sourceCount) {
  const parts = [];

  if (truth.claimClass === claimGate.CLASS.GROUNDED) {
    parts.push('Every finding below is carried by the source named beside it.');
  } else if (truth.claimClass === claimGate.CLASS.PROSE) {
    parts.push('The sources returned nothing checkable on this question, so nothing below is evidence.');
  } else if (!sourceCount) {
    parts.push('No source survived vetting, so there is nothing here to stand on.');
  } else {
    parts.push('At least one finding could not be attributed to the source it came from, so this answer is not evidence.');
  }

  if (truth.attribution.withheld.length) {
    const reasons = [...new Set(truth.attribution.withheld
      .map(w => claimGate.REASON_LABELS[w.reason] ?? w.reason))];
    parts.push(`Withheld ${truth.attribution.withheld.length}: ${reasons.join(', ')}.`);
  }

  parts.push(describeContradictions(crossRef.contradictions, sourceCount));
  return parts.join(' ');
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function extractDomain(url) {
  if (!url) return 'unknown';
  try {
    return new URL(url.startsWith('http') ? url : `https://${url}`).hostname.replace('www.', '');
  } catch { return url.split('/')[0]; }
}

function deduplicateSources(sources) {
  const seen = new Set();
  return sources.filter(s => {
    const key = s.url || `${s.domain}:${(s.content || '').slice(0, 50)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractKeyPhrases(text) {
  // Simple n-gram extraction — Phase 5: replace with NLP
  const words = text.toLowerCase().split(/\W+/).filter(w => w.length > 4);
  const bigrams = [];
  for (let i = 0; i < words.length - 1; i++) {
    bigrams.push(`${words[i]} ${words[i+1]}`);
  }
  return bigrams.slice(0, 20);
}

function roughSentiment(text) {
  const t = text.toLowerCase();
  const posWords = ['increase', 'growth', 'positive', 'strong', 'gain', 'rise', 'up', 'bull', 'good', 'improve'];
  const negWords = ['decline', 'fall', 'negative', 'weak', 'loss', 'drop', 'down', 'bear', 'bad', 'worsen'];
  let pos = 0, neg = 0;
  for (const w of posWords) if (t.includes(w)) pos++;
  for (const w of negWords) if (t.includes(w)) neg++;
  if (pos > neg + 1) return 'positive';
  if (neg > pos + 1) return 'negative';
  return 'neutral';
}

function humanDelay(minMs, maxMs) {
  const delay = minMs + Math.random() * (maxMs - minMs);
  return new Promise(resolve => setTimeout(resolve, delay));
}

// getSourceCredibility exported so other engines (e.g. the agent orchestrator's
// refinement loop, spec section 37) reuse this one scoring table instead of
// each maintaining their own opinion of what's credible.
// `vetSources` and `buildFallbackResults` are exported so the Section 94 fix is TESTED rather than
// merely asserted in a comment — the fabrication it prevents was invisible precisely because nothing
// exercised it.
// `extractTruth`, `buildOutput` and `excerpt` are exported for the same reason: the score they no
// longer emit was asserted absent only by reading the file, and a source-level regex cannot tell
// whether the OBJECT that reaches master carries one. `verifyClaimGate.cjs` now runs both.
module.exports = {
  register, getSourceCredibility, vetSources, buildFallbackResults,
  extractTruth, buildOutput, excerpt,
};
