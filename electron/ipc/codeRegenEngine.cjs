'use strict';

/**
 * codeRegenEngine.cjs — Autonomous Code Regeneration Engine.
 *
 * Rāma detects broken/degraded code in itself or in any project,
 * researches the fix (online docs + GitHub examples),
 * generates a corrected version, and proposes it to master.
 *
 * PIPELINE:
 *   1. DETECT  — error signal from sandbox, AST, self-care, or manual trigger
 *   2. ANALYZE — understand root cause using AST + error context
 *   3. RESEARCH— search docs/GitHub/npm for correct patterns (browserEngine)
 *   4. GENERATE— create fix using best AI model for code tasks
 *   5. VALIDATE— run fixed code in sandbox, compare outputs
 *   6. PROPOSE — show diff to master (NEVER auto-apply without approval)
 *   7. APPLY   — after master approves, write file + commit
 *
 * Safety: All proposals require master approval.
 *         Failed validations are flagged, not hidden.
 *         Every regen is logged with full reasoning.
 */

const crypto = require('crypto');
const path   = require('path');
const fs     = require('fs');
const net    = require('../lib/http.cjs');
const ledger = require('../lib/proposals.cjs');   // shared approve→apply gate

// ─── Regen queue ──────────────────────────────────────────────────────────────
const regenQueue     = [];       // pending analysis items
const regenProposals = new Map();// proposalId → full detail (research, prompt, code)
const regenHistory = [];

// ─── Queue an analysis item ───────────────────────────────────────────────────
function queueAnalysis(item) {
  const id = crypto.randomBytes(6).toString('hex');
  regenQueue.push({ id, ...item, ts: Date.now(), status: 'queued' });
  return id;
}

// ─── Research online for a fix ────────────────────────────────────────────────
async function researchFix(errorMessage, language, codeContext) {
  const findings = [];

  // 1. Search DuckDuckGo for the error
  try {
    const query  = `${language} ${errorMessage.slice(0, 80)} fix solution`;
    const ddgUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`;
    const data   = await httpsGet(ddgUrl);
    const parsed = JSON.parse(data);

    if (parsed.Abstract) {
      findings.push({ source: 'duckduckgo', type: 'abstract', content: parsed.Abstract, url: parsed.AbstractURL });
    }
    if (parsed.RelatedTopics) {
      for (const t of parsed.RelatedTopics.slice(0, 3)) {
        if (t.Text) findings.push({ source: 'duckduckgo', type: 'related', content: t.Text });
      }
    }
  } catch { /* non-fatal */ }

  // 2. Search npm if it's a module-not-found error
  if (/cannot find module|module not found/i.test(errorMessage)) {
    const modMatch = errorMessage.match(/['"]([^'"]+)['"]/);
    if (modMatch) {
      try {
        const pkgName = modMatch[1].replace(/^@[^/]+\//, '');
        const npmData = await httpsGet(`https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(pkgName)}&size=3`);
        const parsed  = JSON.parse(npmData);
        for (const obj of (parsed.objects || []).slice(0, 3)) {
          findings.push({
            source:  'npm',
            type:    'package',
            content: `Package: ${obj.package.name}@${obj.package.version} — ${obj.package.description || ''}`,
            install: `npm install ${obj.package.name}`,
            license: obj.package.license,
          });
        }
      } catch { /* non-fatal */ }
    }
  }

  // 3. Search GitHub code examples
  try {
    const q = encodeURIComponent(`${errorMessage.slice(0, 60)} ${language} fix`);
    const ghData = await httpsGet(`https://api.github.com/search/repositories?q=${q}&sort=stars&per_page=3`, {
      'User-Agent': 'Rama-AGI/1.0',
      'Accept':     'application/vnd.github+json',
    });
    const parsed = JSON.parse(ghData);
    for (const repo of (parsed.items || []).slice(0, 2)) {
      findings.push({
        source:  'github',
        type:    'repo',
        content: `${repo.full_name}: ${repo.description || ''} (${repo.stargazers_count}⭐)`,
        url:     repo.html_url,
      });
    }
  } catch { /* non-fatal */ }

  return findings;
}

// ─── Generate a fix using model router ───────────────────────────────────────
async function generateFix(brokenCode, error, language, researchFindings, filePath) {
  // Try to use model router via IPC if in Electron context
  // Falls back to structural fix if no AI available
  const researchContext = researchFindings
    .slice(0, 5)
    .map(f => `[${f.source}] ${f.content}`)
    .join('\n');

  const prompt = `You are a code repair specialist. Fix the following ${language} code.

ERROR:
${error}

BROKEN CODE:
\`\`\`${language}
${brokenCode.slice(0, 3000)}
\`\`\`

RESEARCH FINDINGS:
${researchContext || 'No research findings available'}

${filePath ? `FILE: ${filePath}` : ''}

INSTRUCTIONS:
1. Identify the root cause of the error
2. Apply the minimal fix necessary
3. Do NOT change any working functionality
4. Return ONLY the fixed code in a code block
5. Add a brief comment above the fix explaining what was changed

Return the complete fixed file content.`;

  return { prompt, researchContext };
}

// ─── Full regen pipeline ──────────────────────────────────────────────────────
async function runRegenPipeline(item, modelResponse) {
  const proposalId = crypto.randomBytes(8).toString('hex');

  let originalCode = '';
  if (item.filePath && fs.existsSync(item.filePath)) {
    originalCode = fs.readFileSync(item.filePath, 'utf8');
  } else if (item.code) {
    originalCode = item.code;
  }

  // Research
  const findings = await researchFix(item.error || 'Unknown error', item.language || 'javascript', originalCode);

  // Generate fix context
  const { prompt, researchContext } = await generateFix(
    originalCode || item.code || '',
    item.error || 'Code quality issue',
    item.language || 'javascript',
    findings,
    item.filePath
  );

  // Register in the shared approval ledger. The ledger holds the lifecycle;
  // the local map holds the bulky research/prompt detail the IDE needs.
  const entry = ledger.create({
    id:      proposalId,
    kind:    ledger.KINDS.REGEN,
    title:   `Fix ${item.filePath ? path.basename(item.filePath) : 'snippet'}`,
    summary: item.error || 'Code quality issue',
    changes: modelResponse && item.filePath
      ? [{ action: 'patch', path: item.filePath, content: modelResponse }]
      : [],
    risk:    'medium',
    meta:    { source: item.source || 'manual', language: item.language || 'javascript' },
  });

  const proposal = {
    id:              proposalId,
    status:          entry.status,
    createdAt:       entry.createdAt,
    source:          item.source || 'manual',
    filePath:        item.filePath || null,
    language:        item.language || 'javascript',
    error:           item.error || null,
    originalCode:    originalCode.slice(0, 5000),
    fixedCode:       modelResponse || null,  // populated when AI responds
    researchFindings: findings,
    aiPrompt:        prompt,
    researchContext,
    requiresInstall: findings.filter(f => f.type === 'package').map(f => f.install),
    validated:       false,
    validationResult: null,
  };

  regenProposals.set(proposalId, proposal);
  regenHistory.unshift({ id: proposalId, ts: Date.now(), source: item.source, status: 'pending' });
  if (regenHistory.length > 200) regenHistory.pop();

  return proposal;
}

// ─── Regen applier ────────────────────────────────────────────────────────────
// Registered with the shared ledger — runs only after approval is recorded.
ledger.registerApplier(ledger.KINDS.REGEN, async (entry) => {
  const detail = regenProposals.get(entry.id);
  const change = (entry.changes || [])[0];
  const target = change?.path || detail?.filePath;
  const code   = change?.content || detail?.fixedCode;

  if (!code)   throw new Error('No fix code available');
  if (!target) throw new Error('No file path specified');

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, code, 'utf8');

  if (detail) { detail.status = 'applied'; detail.appliedAt = Date.now(); }

  // Let the event bus fan this out (selfCare, astEngine, vectorMemory)
  try {
    const { bus } = require('../ramaEventBus.cjs');
    bus.emit('regen:applied', { proposalId: entry.id, filePath: target });
  } catch { /* non-fatal */ }

  return { path: target, written: true };
});

// ─── Register IPC ─────────────────────────────────────────────────────────────
function register(ipcMain) {
  const { BrowserWindow } = require('electron');

  const broadcast = (channel, data) => {
    BrowserWindow.getAllWindows().forEach(w => w.webContents.send(channel, data));
  };

  // ── Queue a regen analysis ────────────────────────────────────────────────
  ipcMain.handle('regen:queue', async (_e, item) => {
    const id = queueAnalysis(item);
    // Immediately start pipeline in background
    runRegenPipeline(item, null).then(proposal => {
      broadcast('regen:proposal-ready', {
        proposalId: proposal.id,
        filePath:   proposal.filePath,
        error:      proposal.error,
        hasResearch: proposal.researchFindings.length > 0,
        requiresInstall: proposal.requiresInstall,
      });
    }).catch(() => {});
    return { ok: true, id };
  });

  // ── Get a proposal ────────────────────────────────────────────────────────
  ipcMain.handle('regen:get-proposal', async (_e, proposalId) => {
    const p = regenProposals.get(proposalId);
    if (!p) return { ok: false, error: 'Proposal not found' };
    // Status is authoritative in the ledger, not in the local detail record
    const entry = ledger.get(proposalId);
    return { ok: true, data: { ...p, status: entry?.status ?? p.status } };
  });

  // ── List proposals ────────────────────────────────────────────────────────
  ipcMain.handle('regen:list-proposals', async () => {
    return { ok: true, data: ledger.list({ kind: ledger.KINDS.REGEN, limit: 50 }) };
  });

  // ── Set AI-generated fix on proposal ──────────────────────────────────────
  ipcMain.handle('regen:set-fix', async (_e, { proposalId, fixedCode }) => {
    const p     = regenProposals.get(proposalId);
    const entry = ledger.get(proposalId);
    if (!p || !entry) return { ok: false, error: 'Proposal not found' };

    p.fixedCode = fixedCode;
    p.status    = 'fix-ready';
    // Attach the concrete change so the ledger's applier is self-sufficient
    entry.changes = p.filePath
      ? [{ action: 'patch', path: p.filePath, content: fixedCode }]
      : [];

    // Verification report for the human deciding — advisory only, does not
    // gate apply(). This is the point real content first exists for this
    // proposal, so it is the right point to run it. See spec section 36.
    try {
      const { verifyProposal } = require('../lib/verifyProposal.cjs');
      entry.meta = { ...entry.meta, verification: await verifyProposal(entry) };
    } catch (err) {
      entry.meta = { ...entry.meta, verification: { ok: false, reason: err.message, files: [] } };
    }

    return { ok: true, data: { verification: entry.meta.verification } };
  });

  // ── Approve / reject / apply — all owned by the shared ledger ─────────────
  ipcMain.handle('regen:apply',   async (_e, { proposalId }) => ledger.apply(proposalId));
  ipcMain.handle('regen:approve', async (_e, proposalId)     => ledger.approve(proposalId, 'master'));
  ipcMain.handle('regen:reject',  async (_e, proposalId)     => ledger.reject(proposalId, 'master'));

  // ── Research a topic (for IDE use) ────────────────────────────────────────
  ipcMain.handle('regen:research', async (_e, { errorMessage, language }) => {
    const findings = await researchFix(errorMessage, language || 'javascript', '');
    return { ok: true, data: findings };
  });

  // ── Get AI prompt for a broken code ───────────────────────────────────────
  ipcMain.handle('regen:get-prompt', async (_e, { code, error, language, filePath }) => {
    const findings       = await researchFix(error || '', language || 'javascript', code || '');
    const { prompt, researchContext } = await generateFix(code || '', error || '', language || 'javascript', findings, filePath);
    return { ok: true, data: { prompt, researchContext, findings } };
  });
}

// Adapter over electron/lib/http.cjs — the single main-process HTTP client.
async function httpsGet(url, headers = {}) {
  const res = await net.get(url, { headers, timeout: 10000 });
  if (res.ok) return res.body;
  throw new Error(res.error || `HTTP ${res.status}`);
}

module.exports = { register, queueAnalysis, runRegenPipeline };
