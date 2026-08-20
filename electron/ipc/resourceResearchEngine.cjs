'use strict';

/**
 * resourceResearchEngine.cjs — Rāma's Resource Research capability.
 *
 * WHAT THIS IS: master asked for a way for Rāma to know what free and premium
 * resources exist for an AGI/ASI system like itself (LLM providers, voice,
 * search, vector memory, etc.), read a resource's ACTUAL current docs on
 * request rather than rely on stale training data, and hand master everything
 * needed to decide — cost, free-tier limits, required credentials — without
 * ever enabling anything silently. Design and research are recorded in
 * RAMA_AGI_MASTER_SPEC.md Section 38.
 *
 * PIPELINE (mirrors evolutionEngine.cjs's scout → propose → ledger shape,
 * aimed at resources/APIs instead of repos):
 *   1. catalog        — seed list (shared/resourceCatalog.json) cross-checked
 *                        against what's already wired/credentialed
 *   2. research       — live fetch of a resource's docs/pricing page,
 *                        heuristic extraction of price/free-tier/rate-limit/
 *                        credential signals. Read-only, no approval needed.
 *   3. propose-enable — turns a research report into a proposals.cjs entry
 *                        (kind RESOURCE). changes[] carries the wiring code
 *                        diff; it NEVER carries a secret value.
 *   4. apply           — same single gate as every other proposal kind
 *                        (invariant I6). Writes the wiring file(s) only.
 *   5. (UI step, not this engine) — if a credential is needed, master pastes
 *      it once and it goes straight to vault:set(), never through the ledger.
 *
 * INVARIANTS RESPECTED:
 *   I6  — nothing written to source without an approved ledger entry.
 *   I10 — a single doc fetch is cheap (same tier as intelligenceEngine's
 *         search calls) and needs no admission check. If a future revision
 *         adds a real crawl/browser-launch workload here, it must call
 *         resourceOrchestrator.admit() first rather than inventing its own
 *         resource check — deliberately not done for the current one-page
 *         fetch, which costs about as much as a single search request.
 *   I11 — this engine is additive. If a docs page cannot be read (JS-rendered,
 *         blocked, offline), research() degrades to an honest "could not
 *         fetch" result rather than fabricating a report.
 */

const fs   = require('fs');
const path = require('path');
const net  = require('../lib/http.cjs');
const proposals = require('../lib/proposals.cjs');
const { getCredential, isUnlocked } = require('./credentialVault.cjs');

// ─── Proposal kind ──────────────────────────────────────────────────────────
// Registered onto the shared ledger (electron/lib/proposals.cjs). Adding a new
// kind here is normal feature wiring, done once at load time — it is not
// itself a self-modification proposal, the same way registering an applier in
// genomeApplier.cjs or evolutionEngine.cjs is not.
if (!proposals.KINDS.RESOURCE) proposals.KINDS.RESOURCE = 'resource';

const CATALOG_PATH = path.join(__dirname, '..', '..', 'shared', 'resourceCatalog.json');

// ─── Catalog ────────────────────────────────────────────────────────────────
function loadCatalog() {
  try {
    return JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
  } catch (err) {
    return { version: 0, axes: {}, error: `Catalog unreadable: ${err.message}` };
  }
}

/**
 * Cross-check the static catalog against live state: is a credential already
 * in the vault, and is the resource already wired into modelRouter/orchestrator?
 * This is best-effort and never throws — a missing optional module must not
 * break the catalog view.
 */
function statusFor(entry) {
  // Needing no credential is not the same as being adopted. This used to return
  // 'no-key-needed' for an unwired entry, which the Resources page renders as a
  // green "READY" — so Qdrant showed as ready while nothing in the codebase
  // referenced it. The design axis would have made that claim about seven more
  // resources at once. Absence of a key requirement is not adoption.
  if (!entry.credKey) {
    return entry.wiredAs ? 'enabled' : 'researched-only';
  }
  const hasKey = isUnlocked() ? !!getCredential(entry.credKey) : null;
  if (entry.wiredAs && hasKey) return 'enabled';
  if (entry.wiredAs && hasKey === false) return 'wired-no-key';
  if (entry.wiredAs && hasKey === null)  return 'wired-vault-locked';
  if (hasKey) return 'keyed-not-wired';
  return 'researched-only';
}

function getCatalogWithStatus() {
  const catalog = loadCatalog();
  const axes = {};
  for (const [axisId, axis] of Object.entries(catalog.axes || {})) {
    axes[axisId] = {
      ...axis,
      resources: (axis.resources || []).map(r => ({ ...r, status: statusFor(r) })),
    };
  }
  return { ...catalog, axes };
}

function findCatalogEntry(resourceId) {
  const catalog = loadCatalog();
  for (const axis of Object.values(catalog.axes || {})) {
    const hit = (axis.resources || []).find(r => r.id === resourceId);
    if (hit) return hit;
  }
  return null;
}

// ─── Live doc research ──────────────────────────────────────────────────────
const MAX_EXCERPT_CHARS = 6000;   // keep the report readable and the ledger entry small

/**
 * Strip HTML down to visible text. Deliberately simple — this is a heuristic
 * signal extractor, not a real HTML parser (astEngine/DOM tooling is not
 * pulled in here just to read a pricing page).
 */
function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Lines/sentences around a keyword — cheap "why did you flag this" evidence. */
function contextAround(text, keyword, radius = 90) {
  const hits = [];
  const lower = text.toLowerCase();
  const kw = keyword.toLowerCase();
  let idx = lower.indexOf(kw);
  let guard = 0;
  while (idx !== -1 && hits.length < 3 && guard < 50) {
    const start = Math.max(0, idx - radius);
    const end   = Math.min(text.length, idx + kw.length + radius);
    hits.push(text.slice(start, end).trim());
    idx = lower.indexOf(kw, idx + kw.length);
    guard++;
  }
  return hits;
}

/**
 * Heuristic requirement extraction, honestly labelled: pattern matches, not
 * semantic understanding. Mirrors the discipline in verifyProposal.cjs and
 * intelligenceEngine.cjs — real signal, no fabricated precision.
 */
function extractSignals(text) {
  const prices = [...new Set((text.match(/\$\s?\d+(?:\.\d+)?(?:\s?\/\s?(?:1[MmKk]|month|mo|request|call|credit)[a-z]*)?/g) || []).slice(0, 12))];
  const rateLimits = [...new Set((text.match(/\d+\s?(?:RPM|RPD|TPM|req(?:uests)?\s?\/\s?min(?:ute)?|requests?\s?per\s?(?:minute|day|month))/gi) || []).slice(0, 8))];

  const freeTierHits  = contextAround(text, 'free tier').concat(contextAround(text, 'free plan'));
  const apiKeyHits    = contextAround(text, 'api key');
  const authHits      = contextAround(text, 'authorization').concat(contextAround(text, 'bearer'));
  const rateLimitHits = contextAround(text, 'rate limit');

  return {
    pricesFound:      prices,
    rateLimitsFound:  rateLimits,
    freeTierMentions: dedupe(freeTierHits),
    apiKeyMentions:   dedupe(apiKeyHits),
    authMentions:     dedupe(authHits),
    rateLimitMentions: dedupe(rateLimitHits),
  };
}

function dedupe(arr) { return [...new Set(arr)].slice(0, 5); }

/**
 * Fetch and analyze a resource's live docs/pricing page.
 * @param {string} url
 * @returns {Promise<object>} research report — never throws; degrades to
 *          `{ ok:false, reason }` when the page cannot be read.
 */
async function researchUrl(url) {
  const res = await net.getHuman(url, { timeout: 15000 });
  if (!res.ok) {
    return {
      ok: false,
      url,
      reason: res.error || `HTTP ${res.status}`,
      hint: 'Site may require JS rendering or block automated fetches. Try browser:open-page + get-content from the IDE/browser tools, or check the URL manually.',
    };
  }

  const text = htmlToText(res.body).slice(0, 20000);
  const signals = extractSignals(text);

  return {
    ok: true,
    url,
    fetchedAt: Date.now(),
    excerpt: text.slice(0, MAX_EXCERPT_CHARS),
    signals,
    disclaimer: 'Heuristic pattern extraction from the live page — verify pricing/limits on the source before deciding. Not a substitute for reading the actual docs.',
  };
}

/**
 * Research a catalog entry by id (uses its docsUrl) or an arbitrary URL master
 * supplies directly — the "check the online docs" ability master asked for is
 * not limited to the seed catalog.
 */
async function research({ resourceId, url } = {}) {
  let entry = null;
  let targetUrl = url;

  if (resourceId) {
    entry = findCatalogEntry(resourceId);
    if (!entry) return { ok: false, reason: `Unknown resource id: ${resourceId}` };
    targetUrl = targetUrl || entry.docsUrl;
  }
  if (!targetUrl) return { ok: false, reason: 'No URL to research — provide resourceId or url' };

  const report = await researchUrl(targetUrl);
  return { ...report, resourceId: resourceId || null, catalogEntry: entry };
}

// ─── Turn a research report into a ledger proposal ─────────────────────────
/**
 * @param {object} opts { resourceId, report, wiring }
 *   wiring: { filePath, content, summary, requiredCredential, risk }
 *   The caller (renderer, via the IDE/chat flow) supplies the actual wiring
 *   code — this engine does not synthesise provider integration code itself;
 *   that synthesis is the same AI-assisted authoring path every other
 *   self-modify proposal goes through. This function's job is only to file it
 *   correctly, with the research findings attached for master to see.
 */
function proposeEnable({ resourceId, report, wiring } = {}) {
  const entry = resourceId ? findCatalogEntry(resourceId) : null;
  const w = wiring || {};

  if (!w.filePath || typeof w.content !== 'string') {
    return { ok: false, error: 'wiring.filePath and wiring.content are required — nothing is proposed without an actual diff to review' };
  }

  const proposal = proposals.create({
    kind:    proposals.KINDS.RESOURCE,
    title:   `Enable resource: ${entry?.name || resourceId || 'unknown'}`,
    summary: w.summary || `Wire up ${entry?.name || resourceId} based on live doc research.`,
    changes: [{ action: fs.existsSync(w.filePath) ? 'patch' : 'create', path: w.filePath, content: w.content }],
    risk:    w.risk || 'medium',
    meta: {
      resourceId:         resourceId || null,
      catalogEntry:        entry,
      research:            report || null,
      requiredCredential:  w.requiredCredential || entry?.credKey || null,
      // The secret itself is never here — only the credential's NAME, so
      // master knows what to enter in vault:set() after this is applied.
    },
  });

  return { ok: true, data: proposal };
}

// ─── Applier — writes the wiring file(s) only, never a secret ─────────────
proposals.registerApplier(proposals.KINDS.RESOURCE, async (proposal, opts = {}) => {
  const changes = proposal.changes || [];
  if (changes.length === 0) throw new Error('Resource proposal has no wiring changes to apply');

  try {
    const { verifyProposal } = require('../lib/verifyProposal.cjs');
    proposal.meta = { ...proposal.meta, verification: await verifyProposal(proposal) };
  } catch (err) {
    proposal.meta = { ...proposal.meta, verification: { ok: false, reason: err.message, files: [] } };
  }

  const results = [];
  for (const change of changes) {
    const absPath = opts.repoPath ? path.join(opts.repoPath, change.path) : change.path;
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, change.content, 'utf8');
    results.push({ path: change.path, written: true });
  }

  return {
    written: results,
    verification: proposal.meta.verification,
    requiredCredential: proposal.meta?.requiredCredential || null,
    nextStep: proposal.meta?.requiredCredential
      ? `Wiring applied. Enter the ${proposal.meta.requiredCredential} value via vault:set to finish enabling this resource.`
      : 'Wiring applied. No credential needed for this resource.',
  };
});

// ─── Register IPC ───────────────────────────────────────────────────────────
function register(ipcMain) {
  ipcMain.handle('resource:catalog', async () => {
    return { ok: true, data: getCatalogWithStatus() };
  });

  ipcMain.handle('resource:research', async (_e, opts) => {
    try {
      const data = await research(opts || {});
      return { ok: true, data };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('resource:propose-enable', async (_e, opts) => proposeEnable(opts || {}));
}

module.exports = { register, getCatalogWithStatus, research, proposeEnable };
