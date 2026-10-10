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

  // EVERY CALL BELOW USED TO PASS THE PATH WHERE `user` BELONGS (audit H9, Section 144).
  //
  // The bridge is `fs.writeFile(user, filePath, content)`. The call was
  // `fs.writeFile(file.path, file.content)` — so the path arrived as `user`, the content arrived as
  // `filePath`, and `content` was undefined. `capability.can()` requires `typeof user.tier ===
  // 'number'`, and a string has no `.tier`, so **every write was DENIED**. Then the function
  // returned `{ ok: true, results }` regardless, which is how self-modification came to report
  // success for work the main process had refused outright.
  //
  // Two bugs in one line, and the second hid the first.
  const results = [];
  for (const file of mod.files) {
    let res;
    if (file.action === 'create' || file.action === 'update') {
      res = await window.rama.fs.writeFile(user, file.path, file.content);
    } else if (file.action === 'delete') {
      res = await window.rama.fs.deleteFile(user, file.path);
    } else {
      // An unrecognised action is REFUSED, not skipped. Skipping it left `res` undefined, which
      // spread into `{ path }` with no `ok` at all — neither success nor failure, and the summary
      // below counted it as neither.
      res = { ok: false, error: `unknown action "${file.action}" — expected create, update or delete` };
    }
    results.push({ path: file.path, action: file.action, ...res });
  }

  // THE SUMMARY IS DERIVED, NOT ASSERTED. REDBY: return `{ ok: true, results }`. A caller that
  // trusts `ok` would then apply a modification, report it applied, and leave the file untouched.
  const failed = results.filter((r) => r.ok !== true);
  return {
    ok: failed.length === 0,
    results,
    failed,
    error: failed.length === 0 ? null
      : `${failed.length} of ${results.length} file operations failed: `
        + failed.map((f) => `${f.path} (${f.error || 'no reason given'})`).join('; '),
  };
}

// ─── Commit modification to git ───────────────────────────────────────────────
/**
 * @param {object} mod
 * @param {string} repoPath
 * @param {object|null} user the signed-in user — `git.stage/commit/push` all take it FIRST.
 *
 * The three git calls had the same defect as the writes above: `repoPath` arrived as `user`, so each
 * was denied, and `stage` was not even checked. A denied stage followed by a commit is a commit of
 * nothing, reported as a commit.
 */
export async function commitModification(mod, repoPath, user = null) {
  if (!isElectron) return { ok: false, error: 'Not in Electron' };

  const files = mod.files.map(f => f.path);
  const staged = await window.rama.git.stage(user, repoPath, files);
  // CHECKED NOW. A failed stage used to be discarded, and the commit below would then either fail
  // confusingly or commit a different set of files than the caller asked for.
  if (staged && staged.ok === false) {
    return { ok: false, error: `nothing was committed: staging failed — ${staged.error}`, staged };
  }
  const commitMsg = `${mod.type === 'create-page' ? 'feat' : 'refactor'}(self-modify): ${mod.description}`;
  const result = await window.rama.git.commit(user, repoPath, commitMsg);
  if (!result?.ok) return result;

  // THE PUSH RESULT IS CARRIED RATHER THAN DROPPED. A commit that succeeded and a push that failed
  // is a different state from both succeeding, and master needs to know which he is in.
  const pushed = await window.rama.git.push(user, repoPath, 'dev');
  return {
    ...result,
    pushed: pushed?.ok === true,
    pushError: pushed?.ok === true ? null : (pushed?.error || 'push gave no reason'),
  };
}

// ─── Read current file for AI to modify ───────────────────────────────────────
/** `user` is required: `fs.readFile(user, filePath)` denies a string in the first position. */
export async function readSourceFile(filePath, user = null) {
  if (!isElectron) return null;
  const res = await window.rama.fs.readFile(user, filePath);
  return res?.ok ? res.content : null;
}

// ─── List all source files ────────────────────────────────────────────────────
export async function listSourceFiles(basePath = 'src', user = null) {
  if (!isElectron) return [];
  const res = await window.rama.fs.searchFiles(user, basePath, '');
  return res?.ok ? res.data : [];
}

// ─── Default page template ────────────────────────────────────────────────────
/**
 * The emitted page writes the type scale as `var(--fs-chrome)`, never as `FS.chrome`
 * (spec Section 136).
 *
 * This is a TEMPLATE STRING that emits a source file. A generated page lives wherever it is
 * written, so an import of src/config/type.js may not resolve from there — and the whole point of
 * scaffolding is that the page works without a later hand fix. The CSS variable needs no import,
 * resolves from :root, and carries the same number, so a page Rāma creates obeys the same floor as
 * one written by hand. The sizes above 11px in this template stay as authored and are part of the
 * residual the type-scale suite budgets.
 */
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
          border: '1px solid ${color}44', fontSize: 'var(--fs-chrome)',
          lineHeight: 'var(--lh-chrome)',
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
          <span style={{ color: 'var(--muted)', fontSize: 'var(--fs-chrome)', lineHeight: 'var(--lh-chrome)' }}>
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
