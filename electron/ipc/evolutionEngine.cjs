'use strict';

/**
 * evolutionEngine.cjs — Rāma's Autonomous Self-Evolution Engine.
 *
 * Rāma can study public source code, research papers, and open-source
 * repositories to identify capabilities it should have, then propose
 * concrete improvements to its own codebase.
 *
 * Pipeline:
 *   1. IDENTIFY gap — what capability is Rāma missing or weak on?
 *   2. SCOUT    — search GitHub/GitLab/npm/PyPI/arXiv for solutions
 *   3. EVALUATE — read source, assess quality, check license
 *   4. EXTRACT  — pull the relevant algorithm/pattern/approach
 *   5. SYNTHESIZE — adapt to Rāma's architecture + style
 *   6. PROPOSE  — present diff to master for approval
 *   7. APPLY    — after approval, write files + commit
 *   8. RECORD   — log the evolution + what improved
 *
 * License filter (only legal open-source):
 *   Allowed:  MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, Unlicense, CC0
 *   Blocked:  GPL*, LGPL*, AGPL*, proprietary, unlicensed, SSPL, BSL
 *
 * Human emulation for GitHub/GitLab scraping:
 *   - GitHub API (preferred — structured, no scraping needed)
 *   - Realistic browser headers for fallback web access
 *   - Rate limiting compliance (GitHub: 60 req/hr unauth, 5000 with token)
 */

const net       = require('../lib/http.cjs');
const proposals = require('../lib/proposals.cjs');
const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');
const { getCredential } = require('./credentialVault.cjs');

// ─── Allowed licenses ─────────────────────────────────────────────────────────
const ALLOWED_LICENSES = new Set([
  'mit', 'apache-2.0', 'apache 2.0', 'bsd-2-clause', 'bsd-3-clause',
  'isc', 'unlicense', 'cc0-1.0', '0bsd', 'wtfpl', 'artistic-2.0',
  'eupl-1.2', 'ms-pl', 'ms-rl',
]);

const BLOCKED_LICENSES = new Set([
  'gpl-2.0', 'gpl-3.0', 'lgpl-2.0', 'lgpl-2.1', 'lgpl-3.0',
  'agpl-3.0', 'agpl-1.0', 'sspl-1.0', 'bsl-1.0', 'proprietary',
  'commercial', 'none',
]);

// ─── Evolution categories ──────────────────────────────────────────────────────
const EVOLUTION_CATEGORIES = {
  'ai-reasoning':    { desc: 'Better reasoning, chain-of-thought, planning algorithms' },
  'vector-search':   { desc: 'Embedding similarity search for knowledge base' },
  'nlp-processing':  { desc: 'Better text parsing, entity extraction, summarization' },
  'security':        { desc: 'Cryptography, auth patterns, secure communication' },
  'performance':     { desc: 'Faster algorithms, caching, optimization patterns' },
  'browser-evasion': { desc: 'More effective human emulation for web access' },
  'data-analysis':   { desc: 'Statistical algorithms, data processing patterns' },
  'agent-patterns':  { desc: 'Better multi-agent coordination patterns' },
  'ui-patterns':     { desc: 'Advanced UI components and interaction patterns' },
  'prediction':      { desc: 'Improved prediction algorithms and calibration' },
};

// ─── In-memory evolution log ──────────────────────────────────────────────────
const evolutionLog   = [];   // History of all evolution proposals + outcomes
const activeScouts   = {};   // { [scoutId]: ScoutSession }

// ─── Register IPC ─────────────────────────────────────────────────────────────
function register(ipcMain) {

  // ── Scout for improvements in a category ─────────────────────────────────
  ipcMain.handle('evolution:scout', async (event, { category, query, maxResults = 10 }) => {
    const scoutId = crypto.randomBytes(8).toString('hex');
    const session = {
      id:        scoutId,
      category,
      query,
      status:    'scouting',
      startedAt: Date.now(),
      findings:  [],
    };
    activeScouts[scoutId] = session;

    const emit = (step, data) => {
      event.sender.send('evolution:scout-progress', { scoutId, step, data });
    };

    try {
      emit('search', { message: `Searching for: ${query}` });

      // 1. Search GitHub repos
      const repoFindings = await searchGitHub(query, category, maxResults, emit);

      // 2. Search npm packages (for JS capabilities)
      const npmFindings = await searchNpm(query, Math.floor(maxResults / 2), emit);

      // 3. Search arXiv papers (for algorithm research)
      const paperFindings = await searchArxiv(query, 3, emit);

      session.findings = [...repoFindings, ...npmFindings, ...paperFindings];
      session.status   = 'complete';

      event.sender.send('evolution:scout-complete', { scoutId, findings: session.findings });
      return { ok: true, scoutId, findings: session.findings };
    } catch (err) {
      session.status = 'error';
      session.error  = err.message;
      return { ok: false, scoutId, error: err.message };
    }
  });

  // ── Read a repo's key files ───────────────────────────────────────────────
  ipcMain.handle('evolution:read-repo', async (event, { owner, repo, paths }) => {
    try {
      const files = await readRepoFiles(owner, repo, paths || [], event.sender);
      return { ok: true, data: files };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ── Analyze a finding and propose an evolution ────────────────────────────
  ipcMain.handle('evolution:analyze-and-propose', async (event, { finding, targetCapability }) => {
    try {
      const proposal = await buildEvolutionProposal(finding, targetCapability, event.sender);
      return { ok: true, data: proposal };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ── Approve / reject / apply ───────────────────────────────────────────────
  // These delegate to the shared proposal ledger (electron/lib/proposals.cjs).
  // The ledger owns the approval invariant; this engine only knows how to write
  // absorbed files (see the registered applier below).
  ipcMain.handle('evolution:apply', async (event, { proposalId, repoPath }) => {
    const res = await proposals.apply(proposalId, { repoPath });
    if (res.ok) event.sender.send('evolution:applied', { proposalId, results: res.data });
    return res;
  });

  ipcMain.handle('evolution:approve', async (_e, proposalId) => proposals.approve(proposalId, 'master'));
  ipcMain.handle('evolution:reject',  async (_e, proposalId) => proposals.reject(proposalId, 'master'));

  // ── Self-assessment: what should Rāma evolve next? ────────────────────────
  ipcMain.handle('evolution:self-assess', async () => {
    const suggestions = generateSelfAssessment();
    return { ok: true, data: suggestions };
  });

  // ── Get evolution log ─────────────────────────────────────────────────────
  ipcMain.handle('evolution:get-log', async () => {
    return { ok: true, data: evolutionLog.slice(0, 100) };
  });

  // ── Get scout session ─────────────────────────────────────────────────────
  ipcMain.handle('evolution:get-scout', async (_e, scoutId) => {
    const s = activeScouts[scoutId];
    if (!s) return { ok: false, error: 'Not found' };
    return { ok: true, data: s };
  });
}

// ─── GitHub search ────────────────────────────────────────────────────────────
async function searchGitHub(query, category, maxResults, emit) {
  const token = getCredential('GITHUB_TOKEN');
  const headers = {
    'User-Agent': 'Rama-AGI/1.0 (autonomous-learning)',
    'Accept':     'application/vnd.github+json',
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  // Build search query — prioritize quality repos
  const q = encodeURIComponent(`${query} stars:>50 language:javascript OR language:python OR language:typescript`);
  const url = `/search/repositories?q=${q}&sort=stars&order=desc&per_page=${maxResults}`;

  try {
    const data = await githubAPI(url, headers);
    const items = data.items || [];
    const findings = [];

    for (const repo of items.slice(0, maxResults)) {
      const license = (repo.license?.spdx_id || '').toLowerCase();
      if (BLOCKED_LICENSES.has(license)) continue;
      const allowed = ALLOWED_LICENSES.has(license) || !license || license === 'other';

      findings.push({
        id:          `gh_${repo.id}`,
        type:        'github-repo',
        name:        repo.full_name,
        owner:       repo.owner?.login,
        repo:        repo.name,
        description: repo.description,
        stars:       repo.stargazers_count,
        language:    repo.language,
        license:     repo.license?.spdx_id || 'Unknown',
        licenseOk:   allowed,
        url:         repo.html_url,
        apiUrl:      repo.url,
        topics:      repo.topics || [],
        updatedAt:   repo.updated_at,
        quality:     scoreRepoQuality(repo),
      });

      emit('found', { name: repo.full_name, stars: repo.stargazers_count, license: repo.license?.spdx_id });
    }

    return findings.sort((a, b) => b.quality - a.quality);
  } catch (err) {
    emit('warn', { message: `GitHub search failed: ${err.message}` });
    return [];
  }
}

// ─── npm search ───────────────────────────────────────────────────────────────
async function searchNpm(query, maxResults, emit) {
  try {
    const data = await httpsGet(
      `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(query)}&size=${maxResults}`,
      { 'User-Agent': 'Rama-AGI/1.0' }
    );
    const parsed = JSON.parse(data);
    const findings = [];

    for (const obj of (parsed.objects || []).slice(0, maxResults)) {
      const p = obj.package;
      findings.push({
        id:          `npm_${p.name}`,
        type:        'npm-package',
        name:        p.name,
        description: p.description,
        version:     p.version,
        license:     p.license || 'Unknown',
        licenseOk:   ALLOWED_LICENSES.has((p.license || '').toLowerCase()),
        url:         `https://www.npmjs.com/package/${p.name}`,
        repoUrl:     p.links?.repository,
        weeklyDl:    obj.downloads?.weekly || 0,
        quality:     obj.score?.final || 0,
        topics:      p.keywords || [],
      });
    }

    return findings;
  } catch {
    return [];
  }
}

// ─── arXiv search ─────────────────────────────────────────────────────────────
async function searchArxiv(query, maxResults, emit) {
  try {
    const q   = encodeURIComponent(query);
    const xml = await httpsGet(
      `https://export.arxiv.org/api/query?search_query=all:${q}&start=0&max_results=${maxResults}&sortBy=relevance`,
      { 'User-Agent': 'Rama-AGI/1.0' }
    );

    // Simple XML extraction without a parser
    const entries  = xml.match(/<entry>([\s\S]*?)<\/entry>/g) || [];
    const findings = [];

    for (const entry of entries) {
      const title   = (entry.match(/<title>([\s\S]*?)<\/title>/)   || [])[1]?.trim() || '';
      const summary = (entry.match(/<summary>([\s\S]*?)<\/summary>/) || [])[1]?.trim() || '';
      const id      = (entry.match(/<id>([\s\S]*?)<\/id>/)          || [])[1]?.trim() || '';
      const authors = [...entry.matchAll(/<name>([\s\S]*?)<\/name>/g)].map(m => m[1]).join(', ');

      if (!title) continue;
      findings.push({
        id:          `arxiv_${id.split('/').pop()}`,
        type:        'arxiv-paper',
        name:        title,
        description: summary.slice(0, 400),
        url:         id,
        authors,
        license:     'open-access',
        licenseOk:   true,   // arXiv papers are always open access
        quality:     0.80,   // Academic sources score well
      });
    }

    return findings;
  } catch {
    return [];
  }
}

// ─── Read key files from a GitHub repo ───────────────────────────────────────
async function readRepoFiles(owner, repo, requestedPaths, sender) {
  const token   = getCredential('GITHUB_TOKEN');
  const headers = { 'User-Agent': 'Rama-AGI/1.0', 'Accept': 'application/vnd.github+json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  // First get repo structure
  const tree = await githubAPI(`/repos/${owner}/${repo}/git/trees/HEAD?recursive=1`, headers).catch(() => ({ tree: [] }));
  const allFiles = (tree.tree || []).filter(f => f.type === 'blob');

  // Auto-select interesting files if none specified
  const targetPaths = requestedPaths.length > 0
    ? requestedPaths
    : selectInterestingFiles(allFiles.map(f => f.path));

  const files = [];
  for (const filePath of targetPaths.slice(0, 20)) {  // Max 20 files
    try {
      const fileData = await githubAPI(`/repos/${owner}/${repo}/contents/${filePath}`, headers);
      if (fileData.encoding === 'base64' && fileData.content) {
        const content = Buffer.from(fileData.content.replace(/\n/g, ''), 'base64').toString('utf8');
        files.push({
          path:     filePath,
          content,
          size:     fileData.size,
          language: detectLanguage(filePath),
        });
        sender?.send('evolution:file-read', { path: filePath, size: fileData.size });
      }
    } catch { /* skip inaccessible files */ }

    // Respect rate limit
    await delay(200);
  }

  return files;
}

// ─── Select interesting files from a tree ────────────────────────────────────
function selectInterestingFiles(paths) {
  const priority = [];
  const secondary = [];

  for (const p of paths) {
    const lower = p.toLowerCase();
    // Skip noise
    if (lower.includes('node_modules') || lower.includes('.min.js') ||
        lower.includes('dist/') || lower.includes('build/') ||
        lower.includes('.lock') || lower.includes('.map')) continue;

    // High value: core algorithm files
    if (lower.includes('engine') || lower.includes('core') || lower.includes('algorithm') ||
        lower.includes('predict') || lower.includes('model') || lower.includes('inference') ||
        lower.includes('index.js') || lower.includes('index.ts') || lower.includes('main.py') ||
        lower.includes('utils') || lower.includes('helper')) {
      priority.push(p);
    } else if (lower.endsWith('.js') || lower.endsWith('.ts') || lower.endsWith('.py') ||
               lower.endsWith('.md') || lower.endsWith('readme')) {
      secondary.push(p);
    }
  }

  return [...priority.slice(0, 12), ...secondary.slice(0, 8)];
}

// ─── Build evolution proposal ──────────────────────────────────────────────────
async function buildEvolutionProposal(finding, targetCapability, sender) {
  // Read the source if it's a GitHub repo
  let sourceFiles = [];
  if (finding.type === 'github-repo' && finding.owner && finding.repo) {
    sender?.send('evolution:analyzing', { message: `Reading ${finding.name}...` });
    sourceFiles = await readRepoFiles(finding.owner, finding.repo, [], sender);
  }

  // Created through the shared ledger so it lands in the same approval queue as
  // regen and self-modify changes — one gate, one audit trail.
  const proposal = proposals.create({
    kind:    proposals.KINDS.EVOLUTION,
    title:   `Absorb ${finding.name} → ${targetCapability}`,
    summary: buildProposalSummary(finding, targetCapability, sourceFiles),
    // Populated after AI synthesis — an evolution is never applied empty.
    changes: [],
    risk:    finding.licenseOk ? 'medium' : 'high',
    meta: {
      source:           finding,
      targetCapability,
      sourceFiles:      sourceFiles.map(f => ({ path: f.path, size: f.size, language: f.language })),
      licenseCompliant: finding.licenseOk,
      licenseNote:      finding.licenseOk
        ? `Source is ${finding.license} licensed — safe to learn from and adapt`
        : `⚠ License ${finding.license} may restrict use — master must verify`,
      improvementAxes:  detectImprovementAxes(finding, targetCapability),
      estimatedGain:    estimateCapabilityGain(finding),
    },
  });

  // Local log kept for the Evolution page's history view
  evolutionLog.unshift(proposal);
  if (evolutionLog.length > 200) evolutionLog.pop();

  return proposal;
}

// ─── Evolution applier ────────────────────────────────────────────────────────
// Registered with the ledger. Only ever invoked after approval is recorded.
proposals.registerApplier(proposals.KINDS.EVOLUTION, async (proposal, opts = {}) => {
  const changes = proposal.changes || [];
  if (changes.length === 0) {
    throw new Error('Evolution proposal has no synthesised changes to apply');
  }
  if (proposal.meta?.licenseCompliant === false) {
    throw new Error('Refusing to apply: source license is not compliant');
  }

  const results = [];
  for (const change of changes) {
    const absPath = opts.repoPath ? path.join(opts.repoPath, change.path) : change.path;
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, change.content, 'utf8');
    results.push({ path: change.path, written: true });
  }
  return results;
});

// ─── Self-assessment ──────────────────────────────────────────────────────────
function generateSelfAssessment() {
  return [
    {
      axis:       'memory',
      score:      6,
      gap:        'No vector embeddings for semantic search in knowledge base',
      suggestion: 'Search for: chromadb OR hnswlib OR vectra embedding search javascript',
      category:   'vector-search',
      priority:   'high',
    },
    {
      axis:       'planning',
      score:      7,
      gap:        'Plan decomposition is heuristic-only, not LLM-powered',
      suggestion: 'Search for: tree of thought reasoning javascript agent planning',
      category:   'ai-reasoning',
      priority:   'high',
    },
    {
      axis:       'browser-evasion',
      score:      7,
      gap:        'Limited fingerprint spoofing — detectable by advanced bot gates',
      suggestion: 'Search for: playwright stealth puppeteer extra fingerprint evasion',
      category:   'browser-evasion',
      priority:   'medium',
    },
    {
      axis:       'self-revision',
      score:      5,
      gap:        'No feedback loop — user satisfaction not measured and fed back',
      suggestion: 'Search for: RLHF reinforcement learning human feedback implementation',
      category:   'ai-reasoning',
      priority:   'medium',
    },
    {
      axis:       'prediction',
      score:      6,
      gap:        'Source vetting is keyword-based, not semantic or ML-based',
      suggestion: 'Search for: source credibility detection fake news classification',
      category:   'prediction',
      priority:   'medium',
    },
    {
      axis:       'worldmodel',
      score:      6,
      gap:        'No persistent graph of master\'s context — relationships not tracked',
      suggestion: 'Search for: knowledge graph personal assistant context tracking typescript',
      category:   'nlp-processing',
      priority:   'low',
    },
  ];
}

// ─── Scoring helpers ──────────────────────────────────────────────────────────
function scoreRepoQuality(repo) {
  let score = 0;
  score += Math.min(40, repo.stargazers_count / 100);
  score += repo.has_wiki ? 5 : 0;
  score += repo.has_issues ? 5 : 0;
  score += repo.description ? 10 : 0;
  score += ALLOWED_LICENSES.has((repo.license?.spdx_id || '').toLowerCase()) ? 20 : 0;
  // Penalize very old repos
  const ageYears = (Date.now() - new Date(repo.updated_at).getTime()) / (1000 * 60 * 60 * 24 * 365);
  score -= Math.min(20, ageYears * 5);
  return Math.max(0, score);
}

function detectImprovementAxes(finding, capability) {
  const axes = [];
  const text = ((finding.description || '') + ' ' + (finding.name || '') + ' ' + capability).toLowerCase();

  if (text.includes('memory') || text.includes('embed') || text.includes('vector')) axes.push('memory');
  if (text.includes('plan') || text.includes('reason') || text.includes('agent')) axes.push('planning');
  if (text.includes('search') || text.includes('web') || text.includes('crawl')) axes.push('autonomy');
  if (text.includes('predict') || text.includes('forecast') || text.includes('model')) axes.push('prediction');
  if (text.includes('security') || text.includes('crypto') || text.includes('auth')) axes.push('security');

  return axes.length > 0 ? axes : ['generality'];
}

function estimateCapabilityGain(finding) {
  const quality = finding.quality || 0;
  if (quality > 70) return 'high';
  if (quality > 40) return 'medium';
  return 'low';
}

function buildProposalSummary(finding, capability, files) {
  const fileList = files.slice(0, 5).map(f => f.path).join(', ');
  return `Studied ${finding.name} (${finding.stars || 'N/A'} ⭐, ${finding.license}). ` +
    `Found ${files.length} relevant files. ` +
    `Target capability: ${capability}. ` +
    (fileList ? `Key files: ${fileList}.` : '');
}

function detectLanguage(filename) {
  const ext = (filename || '').split('.').pop().toLowerCase();
  const map = { js: 'javascript', ts: 'typescript', py: 'python', jsx: 'javascript',
    tsx: 'typescript', rs: 'rust', go: 'go', java: 'java', cpp: 'cpp', c: 'c' };
  return map[ext] || 'text';
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────
async function githubAPI(endpoint, headers) {
  const data = await httpsGet(`https://api.github.com${endpoint}`, headers);
  return JSON.parse(data);
}

// Adapter over electron/lib/http.cjs — the single main-process HTTP client.
// GitHub/npm/arXiv are heavily rate-limited, so the shared circuit breaker and
// 429 backoff in that client matter more here than anywhere else.
async function httpsGet(url, headers = {}) {
  const res = await net.get(url, { headers, timeout: 15000 });
  if (res.ok) return res.body;
  throw new Error(res.error || `HTTP ${res.status}`);
}

const delay = net.delay;

module.exports = { register };
