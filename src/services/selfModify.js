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

  // Registration is a single registry.js patch — see generateRegistryUpdate
  const registrySource = await readSourceFile('src/config/registry.js');
  const files = [{ path: filePath, content: code, action: 'create' }];

  if (registrySource) {
    files.push({
      path:    'src/config/registry.js',
      action:  'update',
      content: generateRegistryUpdate(registrySource, {
        id: safeName.toLowerCase(),
        route, label: name, icon, color,
        desc: description,
        componentPath: `@pages/${safeName}/${safeName}.jsx`,
      }),
    });
  }

  return {
    type:       'create-page',
    description: `Create new page: ${name} at ${route}`,
    files,
    postActions: registrySource
      ? []
      : [{ type: 'register-route', route, component: safeName, path: filePath }],
    requiresRestart: false,
  };
}

// ─── Register a new page in the registry ──────────────────────────────────────
/**
 * Patch src/config/registry.js — the ONE file a new page must be added to.
 *
 * Previously this had to edit App.jsx (route table), Sidebar.jsx (nav items) and
 * voiceEngine.js (voice patterns) separately, which meant a self-created page
 * could end up half-registered. Now a page needs exactly two insertions in one
 * file: a PageDef and a loader entry.
 *
 * @param {string} registrySource  current contents of src/config/registry.js
 * @param {object} page            { id, route, label, icon, color, desc, minTier, keys, voice, componentPath, capabilities }
 * @returns {string} updated source
 */
export function generateRegistryUpdate(registrySource, page) {
  const {
    id, route, label, icon, color = 'var(--accent)', desc = '',
    minTier = 'TIERS.MASTER', keys = [], voice = [],
    componentPath, capabilities = ['custom-page'],
  } = page;

  const arr = (xs) => xs.map(k => `'${String(k).replace(/'/g, "\\'")}'`).join(', ');

  const pageDef = `  {
    route: '${route}', id: '${id}', label: '${label}', icon: '${icon}',
    desc: '${desc.replace(/'/g, "\\'")}', color: '${color}',
    minTier: ${minTier},
    keys: [${arr(keys.length ? keys : [id, label.toLowerCase()])}],
    voice: [${arr(voice.length ? voice : [`open ${label.toLowerCase()}`])}],
    component: '${componentPath}',
    capabilities: [${arr(capabilities)}],
  },
`;

  // 1. Insert the PageDef before the closing bracket of the PAGES array
  const pagesEnd = registrySource.indexOf('\n];', registrySource.indexOf('export const PAGES'));
  if (pagesEnd === -1) throw new Error('Could not locate PAGES array in registry.js');
  let updated = registrySource.slice(0, pagesEnd + 1) + pageDef + registrySource.slice(pagesEnd + 1);

  // 2. Insert the lazy loader entry
  const loadersIdx = updated.indexOf('const LOADERS = {');
  if (loadersIdx === -1) throw new Error('Could not locate LOADERS map in registry.js');
  const loadersEnd = updated.indexOf('\n};', loadersIdx);
  const loaderLine = `  ${id}: () => import('${componentPath}'),`;
  updated = updated.slice(0, loadersEnd + 1) + loaderLine + '\n' + updated.slice(loadersEnd + 1);

  return updated;
}

// ─── Propose a modification (goes to the shared approval ledger) ───────────────
/**
 * Submits a change to electron/lib/proposals.cjs — the same gate the evolution
 * and code-regen engines use. Rāma cannot write to its own source without an
 * approval recorded there.
 * @returns {Promise<{ok:boolean, id?:string, error?:string}>}
 */
export async function proposeModification(mod, user = null) {
  if (!isElectron) return { ok: false, error: 'Not in Electron' };

  const res = await window.rama.proposals.create({
    user,
    kind:    'self-modify',
    title:   mod.description,
    summary: mod.description,
    changes: (mod.files || []).map(f => ({
      action:  f.action === 'update' ? 'patch' : f.action,
      path:    f.path,
      content: f.content,
    })),
    requiresRestart: !!mod.requiresRestart,
    risk:    mod.requiresRestart ? 'high' : 'medium',
    meta:    { type: mod.type, postActions: mod.postActions || [] },
  });

  return res.ok ? { ok: true, id: res.data.id } : res;
}

// ─── Apply a modification (write files) ──────────────────────────────────────
/**
 * Writes an approved modification. If the change came through the ledger, pass
 * `mod.proposalId` and the ledger performs the write + audit. The direct-write
 * path remains for master-initiated edits that were approved inline in the UI.
 */
export async function applyModification(mod, user = null) {
  if (!isElectron) return { ok: false, error: 'Not in Electron' };

  // Ledger-backed path — preferred, keeps one audit trail.
  // The signed-in user is passed, not the literal 'master' this used to send: the
  // ledger took that string as an identity and now refuses it (Section 57).
  if (mod.proposalId) {
    const approved = await window.rama.proposals.approve(mod.proposalId, user);
    if (approved && approved.ok === false) return approved;
    return window.rama.proposals.apply(mod.proposalId, { user });
  }

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
