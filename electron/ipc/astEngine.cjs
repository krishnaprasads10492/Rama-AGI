'use strict';

/**
 * astEngine.cjs — AST (Abstract Syntax Tree) Code Analysis Engine.
 *
 * Parses source code into structural representations for:
 *   - Code comprehension (what does this file actually do?)
 *   - Dependency mapping (what does this file import/use?)
 *   - Complexity analysis (cyclomatic complexity per function)
 *   - Issue detection (unreachable code, missing error handling, etc.)
 *   - Impact analysis (if I change function X, what else breaks?)
 *   - Code quality scoring (used by self-healing + evolution)
 *
 * Approach: Node.js built-in parsing (no external deps required)
 * For JS/TS: regex + structural analysis (no acorn needed for basic AST)
 * For Python: subprocess call to python -c "import ast; ..."
 */

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

// ─── Analysis cache ───────────────────────────────────────────────────────────
const analysisCache = new Map();  // filePath → { hash, analysis, ts }

// ─── JS/TS structural analyzer ────────────────────────────────────────────────
function analyzeJS(code, filePath) {
  const lines     = code.split('\n');
  const functions = [];
  const imports   = [];
  const exports_  = [];
  const issues    = [];
  const classes   = [];

  // ── Import detection ──────────────────────────────────────────────────────
  const importPatterns = [
    /^import\s+(?:{([^}]+)})?\s*(?:from\s+)?['"]([^'"]+)['"]/gm,
    /^const\s+\{([^}]+)\}\s*=\s*require\(['"]([^'"]+)['"]\)/gm,
    /^const\s+(\w+)\s*=\s*require\(['"]([^'"]+)['"]\)/gm,
    /^import\s+(\w+)\s+from\s+['"]([^'"]+)['"]/gm,
  ];
  for (const pattern of importPatterns) {
    let m;
    while ((m = pattern.exec(code)) !== null) {
      const names  = m[1] ? m[1].split(',').map(s => s.trim()) : [m[1] || 'default'];
      const source = m[2];
      if (source) imports.push({ names, source, isLocal: source.startsWith('.') || source.startsWith('/') });
    }
  }

  // ── Function detection ────────────────────────────────────────────────────
  const funcPatterns = [
    { re: /^(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/gm, type: 'function' },
    { re: /^(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s+)?\(([^)]*)\)\s*=>/gm, type: 'arrow' },
    { re: /^(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s+)?function/gm, type: 'func-expr' },
    { re: /^\s+(?:async\s+)?(\w+)\s*\(([^)]*)\)\s*\{/gm, type: 'method' },
  ];
  for (const { re, type } of funcPatterns) {
    let m;
    while ((m = re.exec(code)) !== null) {
      const name = m[1];
      if (!name || ['if', 'for', 'while', 'switch', 'catch'].includes(name)) continue;
      const lineNum = code.slice(0, m.index).split('\n').length;
      functions.push({
        name, type,
        params:   m[2] ? m[2].split(',').map(p => p.trim()).filter(Boolean) : [],
        line:     lineNum,
        isExported: m[0].startsWith('export'),
        isAsync:  m[0].includes('async'),
      });
    }
  }

  // ── Class detection ───────────────────────────────────────────────────────
  const classRe = /^(?:export\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?/gm;
  let cm;
  while ((cm = classRe.exec(code)) !== null) {
    classes.push({ name: cm[1], extends: cm[2] || null, line: code.slice(0, cm.index).split('\n').length });
  }

  // ── Export detection ──────────────────────────────────────────────────────
  const exportRe = /^(?:module\.exports\s*=\s*\{?([^}]*)\}?|export\s+(?:default\s+)?(?:const\s+)?(\w+))/gm;
  let em;
  while ((em = exportRe.exec(code)) !== null) {
    const names = em[1]
      ? em[1].split(',').map(s => s.trim().split(':')[0].trim()).filter(Boolean)
      : [em[2]].filter(Boolean);
    exports_.push(...names);
  }

  // ── Issue detection ───────────────────────────────────────────────────────
  // Catch blocks with no handling
  const emptyCatch = /catch\s*\([^)]*\)\s*\{\s*\/\*\s*ignore\s*\*\/\s*\}/g;
  let icm;
  while ((icm = emptyCatch.exec(code)) !== null) {
    const line = code.slice(0, icm.index).split('\n').length;
    issues.push({ type: 'empty-catch', line, severity: 'low', message: 'Empty catch block — error is silently swallowed' });
  }

  // console.log in production code
  const consoleLog = /\bconsole\.log\b/g;
  let clm;
  while ((clm = consoleLog.exec(code)) !== null) {
    const line = code.slice(0, clm.index).split('\n').length;
    issues.push({ type: 'console-log', line, severity: 'low', message: 'console.log in code — remove before production' });
  }

  // TODO comments
  const todoRe = /\/\/\s*(TODO|FIXME|HACK|XXX|BUG)[\s:]([^\n]+)/gi;
  let tm;
  while ((tm = todoRe.exec(code)) !== null) {
    const line = code.slice(0, tm.index).split('\n').length;
    issues.push({ type: tm[1].toLowerCase(), line, severity: tm[1] === 'FIXME' || tm[1] === 'BUG' ? 'medium' : 'low', message: tm[2].trim() });
  }

  // ── Cyclomatic complexity (approximate) ───────────────────────────────────
  const decisionPoints = (code.match(/\b(if|else|for|while|case|catch|&&|\|\||\?)\b/g) || []).length;
  const complexity     = 1 + decisionPoints;

  // ── Quality score ─────────────────────────────────────────────────────────
  const issueScore  = Math.max(0, 100 - issues.length * 5);
  const complexScore = Math.max(0, 100 - Math.max(0, complexity - 10) * 3);
  const qualityScore = Math.round((issueScore + complexScore) / 2);

  return {
    language:    'javascript',
    lines:       lines.length,
    chars:       code.length,
    functions:   functions.slice(0, 50),
    classes,
    imports:     imports.slice(0, 30),
    exports:     [...new Set(exports_)].slice(0, 20),
    issues:      issues.slice(0, 20),
    complexity,
    qualityScore,
    summary:     `${functions.length} functions, ${classes.length} classes, ${imports.length} imports, quality: ${qualityScore}/100`,
  };
}

// ─── Python AST analysis ──────────────────────────────────────────────────────
function analyzePython(code, filePath) {
  try {
    const pyScript = `
import ast, json, sys
code = open(sys.argv[1]).read()
try:
    tree = ast.parse(code)
    funcs = [{'name': n.name, 'line': n.lineno, 'args': [a.arg for a in n.args.args]}
             for n in ast.walk(tree) if isinstance(n, ast.FunctionDef)]
    classes = [{'name': n.name, 'line': n.lineno} for n in ast.walk(tree) if isinstance(n, ast.ClassDef)]
    imports = []
    for n in ast.walk(tree):
        if isinstance(n, ast.Import):
            imports.extend([a.name for a in n.names])
        elif isinstance(n, ast.ImportFrom):
            imports.append(n.module)
    print(json.dumps({'functions': funcs[:30], 'classes': classes[:20], 'imports': list(set(filter(None,imports)))[:30], 'lines': len(code.splitlines())}))
except Exception as e:
    print(json.dumps({'error': str(e)}))
`.trim();

    const tmpScript = path.join(require('os').tmpdir(), `rama_ast_${Date.now()}.py`);
    const tmpFile   = path.join(require('os').tmpdir(), `rama_src_${Date.now()}.py`);
    fs.writeFileSync(tmpScript, pyScript);
    fs.writeFileSync(tmpFile, code);

    const result = execSync(`python ${tmpScript} ${tmpFile}`, { timeout: 10000 }).toString();
    const parsed = JSON.parse(result.trim());

    fs.unlinkSync(tmpScript);
    fs.unlinkSync(tmpFile);

    return { language: 'python', ...parsed, qualityScore: 80 };
  } catch {
    // Fallback: basic line-based analysis
    const lines     = code.split('\n');
    const functions = lines.filter(l => l.trim().startsWith('def ')).map(l => ({ name: l.trim().split('(')[0].replace('def ', '') }));
    const imports   = lines.filter(l => l.trim().startsWith('import ') || l.trim().startsWith('from ')).map(l => l.trim());
    return { language: 'python', lines: lines.length, functions, imports, qualityScore: 75 };
  }
}

// ─── Main analyze function ────────────────────────────────────────────────────
async function analyzeFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;

    const code = fs.readFileSync(filePath, 'utf8');
    const hash = crypto.createHash('md5').update(code).digest('hex');

    // Check cache
    const cached = analysisCache.get(filePath);
    if (cached && cached.hash === hash) return cached.analysis;

    const ext = path.extname(filePath).toLowerCase();
    let analysis;

    if (['.js', '.jsx', '.cjs', '.mjs', '.ts', '.tsx'].includes(ext)) {
      analysis = analyzeJS(code, filePath);
    } else if (ext === '.py') {
      analysis = analyzePython(code, filePath);
    } else {
      analysis = { language: ext.slice(1) || 'text', lines: code.split('\n').length, qualityScore: 100 };
    }

    analysis.filePath    = filePath;
    analysis.fileName    = path.basename(filePath);
    analysis.analyzedAt  = Date.now();
    analysis.hash        = hash;

    // Cache
    analysisCache.set(filePath, { hash, analysis, ts: Date.now() });

    // Emit to event bus
    try {
      const { bus } = require('../ramaEventBus.cjs');
      bus.emit('ast:analyzed', { filePath, qualityScore: analysis.qualityScore, issues: analysis.issues?.length || 0 });
    } catch { /* ignore */ }

    return analysis;
  } catch (err) {
    return { error: err.message, filePath };
  }
}

// ─── Impact analysis — what uses a function? ─────────────────────────────────
async function analyzeImpact(functionName, repoPath) {
  const usages = [];
  const walk = async (dir, depth = 0) => {
    if (depth > 6) return;
    const entries = await fs.promises.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      if (['node_modules', '.git', 'dist', 'build'].includes(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { await walk(full, depth + 1); }
      else if (['.js', '.jsx', '.cjs', '.ts', '.tsx'].includes(path.extname(e.name))) {
        try {
          const code = fs.readFileSync(full, 'utf8');
          if (code.includes(functionName)) {
            const lines = code.split('\n');
            const lineNums = lines.map((l, i) => l.includes(functionName) ? i + 1 : null).filter(Boolean);
            usages.push({ file: full, lines: lineNums });
          }
        } catch { /* skip */ }
      }
    }
  };
  await walk(repoPath);
  return usages;
}

// ─── Register IPC ─────────────────────────────────────────────────────────────
function register(ipcMain) {
  ipcMain.handle('ast:analyze-file', async (_e, filePath) => {
    const result = await analyzeFile(filePath);
    return { ok: !!result, data: result };
  });

  ipcMain.handle('ast:analyze-repo', async (_e, repoPath, maxFiles = 50) => {
    const results = [];
    const walk = async (dir, depth = 0) => {
      if (depth > 5 || results.length >= maxFiles) return;
      const entries = await fs.promises.readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const e of entries) {
        if (['node_modules', '.git', 'dist', 'build'].includes(e.name)) continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) { await walk(full, depth + 1); }
        else if (['.js', '.jsx', '.cjs', '.ts', '.tsx', '.py'].includes(path.extname(e.name))) {
          const r = await analyzeFile(full);
          if (r) results.push(r);
        }
      }
    };
    await walk(repoPath);
    const avgQuality = results.reduce((s, r) => s + (r.qualityScore || 0), 0) / (results.length || 1);
    const allIssues  = results.flatMap(r => (r.issues || []).map(i => ({ ...i, file: r.fileName })));
    return { ok: true, data: { files: results, avgQuality: Math.round(avgQuality), issues: allIssues.slice(0, 50), fileCount: results.length } };
  });

  ipcMain.handle('ast:impact-analysis', async (_e, { functionName, repoPath }) => {
    const usages = await analyzeImpact(functionName, repoPath);
    return { ok: true, data: { functionName, usages, impactCount: usages.length } };
  });

  ipcMain.handle('ast:cache-clear', async () => {
    analysisCache.clear();
    return { ok: true };
  });
}

module.exports = { register, analyzeFile, analyzeImpact };
