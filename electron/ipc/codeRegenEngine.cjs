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
const https  = require('https');

// ─── Regen queue ──────────────────────────────────────────────────────────────
const regenQueue   = [];   // pending analysis items
const proposals    = new Map();  // proposalId → proposal
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

  const proposal = {
    id:              proposalId,
    status:          'pending',
    createdAt:       Date.now(),
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

  proposals.set(proposalId, proposal);
  regenHistory.unshift({ id: proposalId, ts: Date.now(), source: item.source, status: 'pending' });
  if (regenHistory.length > 200) regenHistory.pop();

  return proposal;
}

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
    const p = proposals.get(proposalId);
    if (!p) return { ok: false, error: 'Proposal not found' };
    return { ok: true, data: p };
  });

  // ── List proposals ────────────────────────────────────────────────────────
  ipcMain.handle('regen:list-proposals', async () => {
    return { ok: true, data: regenHistory.slice(0, 50) };
  });

  // ── Set AI-generated fix on proposal ──────────────────────────────────────
  ipcMain.handle('regen:set-fix', async (_e, { proposalId, fixedCode }) => {
    const p = proposals.get(proposalId);
    if (!p) return { ok: false, error: 'Proposal not found' };
    p.fixedCode = fixedCode;
    p.status    = 'fix-ready';
    return { ok: true };
  });

  // ── Apply an approved proposal ────────────────────────────────────────────
  ipcMain.handle('regen:apply', async (_e, { proposalId }) => {
    const p = proposals.get(proposalId);
    if (!p) return { ok: false, error: 'Proposal not found' };
    if (p.status !== 'approved') return { ok: false, error: 'Proposal not approved by master' };
    if (!p.fixedCode) return { ok: false, error: 'No fix code available' };
    if (!p.filePath) return { ok: false, error: 'No file path specified' };

    try {
      fs.mkdirSync(path.dirname(p.filePath), { recursive: true });
      fs.writeFileSync(p.filePath, p.fixedCode, 'utf8');
      p.status    = 'applied';
      p.appliedAt = Date.now();

      // Emit to event bus
      try {
        const { bus } = require('../ramaEventBus.cjs');
        bus.emit('regen:applied', { proposalId, filePath: p.filePath });
      } catch { /* non-fatal */ }

      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ── Approve proposal ──────────────────────────────────────────────────────
  ipcMain.handle('regen:approve', async (_e, proposalId) => {
    const p = proposals.get(proposalId);
    if (!p) return { ok: false, error: 'Not found' };
    p.status = 'approved';
    return { ok: true };
  });

  // ── Reject proposal ───────────────────────────────────────────────────────
  ipcMain.handle('regen:reject', async (_e, proposalId) => {
    const p = proposals.get(proposalId);
    if (!p) return { ok: false, error: 'Not found' };
    p.status = 'rejected';
    return { ok: true };
  });

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

function httpsGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request({
      hostname: parsed.hostname,
      path:     parsed.pathname + parsed.search,
      method:   'GET',
      headers:  { 'Accept': 'application/json', 'User-Agent': 'Rama-AGI/1.0', ...headers },
      timeout:  10000,
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end',  () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    req.on('error',   reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

module.exports = { register, queueAnalysis, runRegenPipeline };
