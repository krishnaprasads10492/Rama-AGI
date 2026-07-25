/**
 * selfModify.js — Rāma's self-modification engine.
 * Rāma can create new pages, update components, patch logic,
 * and push changes to GitHub — all version-controlled.
 *
 * ALL modifications go through:
 *   1. Generate diff / new file content
 *   2. Show master for approval
 *   3. Write file (via IPC)
 *   4. Vite HMR picks up changes (or restart for main process)
 *   5. Commit + push to GitHub
 */

const isElectron = typeof window !== 'undefined' && !!window.rama;

// ─── Page registration registry (in-memory, synced to disk) ──────────────────
let customPageRegistry = [];

// ─── Create a new page ────────────────────────────────────────────────────────
/**
 * @param {object} opts
 * @param {string} opts.name        - Page name, e.g. "Weather"
 * @param {string} opts.route       - URL route, e.g. "/weather"
 * @param {string} opts.icon        - Single char icon, e.g. "☁"
 * @param {string} opts.color       - CSS color, e.g. "var(--accent)"
 * @param {string} opts.description - What this page does
 * @param {string} opts.aiPrompt    - Describe what the page should look like/do
 * @param {string} [opts.generatedCode] - Pre-generated JSX code (from AI)
 */
export async function createPage(opts) {
  const { name, route, icon, color, description, generatedCode } = opts;

  const safeName = name.replace(/[^a-zA-Z0-9]/g, '');
  const dirPath  = `src/pages/${safeName}`;
  const filePath = `${dirPath}/${safeName}.jsx`;

  const code = generatedCode || generateDefaultPage(safeName, name, icon, color, description);

  return {
    type:       'create-page',
    description: `Create new page: ${name} at ${route}`,
    files: [
      { path: filePath, content: code, action: 'create' },
    ],
    postActions: [
      { type: 'register-route', route, component: safeName, path: filePath },
    ],
    requiresRestart: false,
  };
}

// ─── Register a route in App.jsx ──────────────────────────────────────────────
export async function generateRouteUpdate(currentAppJsx, route, componentName, importPath) {
  // Insert import
  const importLine   = `const ${componentName} = React.lazy(() => import('${importPath}'));`;
  const routeLine    = `              <Route path="${route}" element={<${componentName} />} />`;

  // Find insertion points
  const lastLazyIdx  = currentAppJsx.lastIndexOf("React.lazy");
  const lastLazyEnd  = currentAppJsx.indexOf('\n', lastLazyIdx) + 1;
  const catchAllIdx  = currentAppJsx.indexOf('Catch-all');

  let updated = currentAppJsx;
  // Add import after last lazy import
  updated = updated.slice(0, lastLazyEnd) + importLine + '\n' + updated.slice(lastLazyEnd);
  // Add route before catch-all
  const catchIdx2 = updated.indexOf('Catch-all');
  const lineStart = updated.lastIndexOf('\n', catchIdx2);
  updated = updated.slice(0, lineStart) + '\n' + routeLine + updated.slice(lineStart);

  return updated;
}

// ─── Generate Sidebar update ──────────────────────────────────────────────────
export function generateNavItem(route, icon, label, color, title) {
  return `  { route: '${route}', icon: '${icon}', label: '${label}', color: '${color}', title: '${title}' },`;
}

// ─── Apply a modification (write files) ──────────────────────────────────────
export async function applyModification(mod) {
  if (!isElectron) return { ok: false, error: 'Not in Electron' };

  const results = [];
  for (const file of mod.files) {
    let res;
    if (file.action === 'create' || file.action === 'update') {
      res = await window.rama.fs.writeFile(file.path, file.content);
    } else if (file.action === 'delete') {
      res = await window.rama.fs.deleteFile(file.path);
    }
    results.push({ path: file.path, ...res });
  }

  return { ok: true, results };
}

// ─── Commit modification to git ───────────────────────────────────────────────
export async function commitModification(mod, repoPath) {
  if (!isElectron) return { ok: false, error: 'Not in Electron' };

  const files = mod.files.map(f => f.path);
  await window.rama.git.stage(repoPath, files);
  const commitMsg = `${mod.type === 'create-page' ? 'feat' : 'refactor'}(self-modify): ${mod.description}`;
  const result = await window.rama.git.commit(repoPath, commitMsg);
  if (result.ok) await window.rama.git.push(repoPath, 'dev');
  return result;
}

// ─── Read current file for AI to modify ───────────────────────────────────────
export async function readSourceFile(filePath) {
  if (!isElectron) return null;
  const res = await window.rama.fs.readFile(filePath);
  return res.ok ? res.content : null;
}

// ─── List all source files ────────────────────────────────────────────────────
export async function listSourceFiles(basePath = 'src') {
  if (!isElectron) return [];
  const res = await window.rama.fs.searchFiles(basePath, '');
  return res.ok ? res.data : [];
}

// ─── Default page template ────────────────────────────────────────────────────
function generateDefaultPage(componentName, displayName, icon, color, description) {
  return `import React, { useState } from 'react';

/**
 * ${displayName} — Custom page created by Rāma AGI.
 * ${description}
 */
export default function ${componentName}() {
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        padding: '14px 20px', borderBottom: '1px solid var(--border)',
        background: 'var(--surface)', display: 'flex', alignItems: 'center',
        gap: '12px', flexShrink: 0,
      }}>
        <span style={{ fontSize: '18px' }}>${icon}</span>
        <span style={{ fontWeight: 700, color: '${color}', letterSpacing: '0.1em' }}>
          ${displayName.toUpperCase()}
        </span>
        <span className="badge" style={{
          background: '${color}22', color: '${color}',
          border: '1px solid ${color}44', fontSize: '9px',
          padding: '2px 8px', borderRadius: '2px',
        }}>CUSTOM PAGE</span>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px', display: 'flex',
        alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '16px' }}>
        <div style={{ fontSize: '48px' }}>${icon}</div>
        <div style={{ color: '${color}', fontWeight: 700, fontSize: '16px', letterSpacing: '0.1em' }}>
          ${displayName.toUpperCase()}
        </div>
        <div style={{ color: 'var(--text-dim)', fontSize: '12px', textAlign: 'center', lineHeight: '1.8', maxWidth: '400px' }}>
          ${description}<br />
          <span style={{ color: 'var(--muted)', fontSize: '11px' }}>
            This page was created by Rāma AGI. Rāma can update it with more functionality on request.
          </span>
        </div>
      </div>
    </div>
  );
}
`;
}

export { customPageRegistry };
