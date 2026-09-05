'use strict';

/**
 * genome.cjs — Rāma's capability genome.
 *
 * THE IDEA (holonic architecture):
 *   Every Rāma instance carries the COMPLETE genome — the full set of genes for
 *   every capability the system has. An instance only *expresses* the genes its
 *   role needs; the rest stay dormant but present. That means:
 *
 *     - No instance is a crippled subset. Any instance can express any dormant
 *       gene at runtime and take over another instance's role.
 *     - Losing an instance loses no capability. The genome is whole in each one.
 *     - A capability is added ONCE here and becomes reachable to every instance.
 *
 * WHERE THE PIECES LIVE:
 *   - Identity / loyalty / ethics  → nucleusSealer.cjs (encrypted, master-only)
 *   - Gene definitions             → this file (public — they describe wiring)
 *   - Instance expression state    → instanceManager.cjs, persisted encrypted
 *   - Genome changes               → lib/proposals.cjs (GENOME kind, master gate)
 *
 * Genes are declarative and verifiable: each names the engine module that
 * implements it, so `verify()` reports honestly which genes are actually live on
 * this machine rather than assuming the manifest is true.
 */

const crypto = require('crypto');
const path   = require('path');

const GENOME_VERSION = 1;

// ─── Capability domains ───────────────────────────────────────────────────────
const DOMAINS = {
  PERCEPTION:     'perception',      // taking the world in
  REASONING:      'reasoning',       // making sense of it
  ACTION:         'action',          // changing it
  MEMORY:         'memory',          // remembering it
  COORDINATION:   'coordination',    // working with others
  SECURITY:       'security',        // protecting master and self
  SELF_EVOLUTION: 'self-evolution',  // improving itself
  GOVERNANCE:     'governance',      // limits, ethics, loyalty
};

/**
 * @typedef  {Object} Gene
 * @property {string}   id       stable gene identifier
 * @property {string}   domain   one of DOMAINS
 * @property {string}   label    human-readable name
 * @property {string}   engine   module path that implements it (relative to electron/)
 * @property {string[]} channels IPC channel prefixes the gene owns
 * @property {string}   cap      accessControl capability key that gates it
 * @property {boolean}  core     core genes are expressed by EVERY instance
 * @property {string[]} requires other gene ids this one depends on
 */

/** @type {Gene[]} */
const GENES = [
  // ── Governance (always expressed — this is what makes it Rāma) ─────────────
  { id: 'g.loyalty',        domain: DOMAINS.GOVERNANCE,   label: 'Loyalty Core',            engine: 'nucleusSealer.cjs',        channels: ['nucleus:'],   cap: 'identity.reveal',      core: true,  requires: [] },
  { id: 'g.ethics',         domain: DOMAINS.GOVERNANCE,   label: 'Ethical Core',            engine: 'nucleusSealer.cjs',        channels: ['nucleus:'],   cap: 'identity.reveal',      core: true,  requires: ['g.loyalty'] },
  { id: 'g.approval',       domain: DOMAINS.GOVERNANCE,   label: 'Change Approval Gate',    engine: 'lib/proposals.cjs',        channels: ['proposals:'], cap: 'self-modify.view',     core: true,  requires: [] },
  { id: 'g.access',         domain: DOMAINS.GOVERNANCE,   label: 'Access Control',          engine: 'sessionManager.cjs',       channels: ['session:'],   cap: 'users.view',           core: true,  requires: [] },

  // ── Security ──────────────────────────────────────────────────────────────
  { id: 'g.crypto',         domain: DOMAINS.SECURITY,     label: 'Encryption Foundry',      engine: 'cryptoCore.cjs',           channels: ['store:'],     cap: 'vault.unlock',         core: true,  requires: [] },
  { id: 'g.vault',          domain: DOMAINS.SECURITY,     label: 'Credential Vault',        engine: 'ipc/credentialVault.cjs',  channels: ['vault:'],     cap: 'vault.read',           core: false, requires: ['g.crypto'] },
  { id: 'g.ipc-seal',       domain: DOMAINS.SECURITY,     label: 'IPC Flow Encryption',     engine: 'ipcEncryption.cjs',        channels: ['ipc-enc:'],   cap: 'vault.unlock',         core: true,  requires: ['g.crypto'] },
  { id: 'g.sandbox',        domain: DOMAINS.SECURITY,     label: 'Execution Sandbox',       engine: 'ipc/sandboxEngine.cjs',    channels: ['sandbox:'],   cap: 'terminal.open',        core: false, requires: [] },

  // ── Perception ────────────────────────────────────────────────────────────
  { id: 'g.os-sense',       domain: DOMAINS.PERCEPTION,   label: 'System Sensing',          engine: 'ipc/system.cjs',           channels: ['system:'],    cap: 'os.metrics-read',      core: true,  requires: [] },
  { id: 'g.filesystem',     domain: DOMAINS.PERCEPTION,   label: 'Filesystem Access',       engine: 'ipc/filesystem.cjs',       channels: ['fs:'],        cap: 'os.filesystem-read',   core: false, requires: [] },
  { id: 'g.browser',        domain: DOMAINS.PERCEPTION,   label: 'Browser & Internet',      engine: 'ipc/browserEngine.cjs',    channels: ['browser:'],   cap: 'browser.search',       core: false, requires: [] },
  { id: 'g.app-sense',      domain: DOMAINS.PERCEPTION,   label: 'Installed App Awareness', engine: 'ipc/appAssimilation.cjs',  channels: ['apps:'],      cap: 'apps.view',            core: false, requires: [] },

  // ── Reasoning ─────────────────────────────────────────────────────────────
  { id: 'g.model-router',   domain: DOMAINS.REASONING,    label: 'Multi-Model Router',      engine: 'ipc/modelRouter.cjs',      channels: ['models:'],    cap: 'models.use',           core: true,  requires: [] },
  { id: 'g.graph-plan',     domain: DOMAINS.REASONING,    label: 'Graph Planner (DAG)',     engine: 'ipc/graphReasoner.cjs',    channels: ['graph:'],     cap: 'chat.send',            core: false, requires: [] },
  { id: 'g.intelligence',   domain: DOMAINS.REASONING,    label: 'Truth & Prediction',      engine: 'ipc/intelligenceEngine.cjs',channels: ['intel:'],    cap: 'browser.search',       core: false, requires: ['g.browser'] },
  { id: 'g.ast',            domain: DOMAINS.REASONING,    label: 'Code Comprehension',      engine: 'ipc/astEngine.cjs',        channels: ['ast:'],       cap: 'os.filesystem-read',   core: false, requires: ['g.filesystem'] },
  { id: 'g.metacognition',  domain: DOMAINS.REASONING,    label: 'Meta-Cognitive Audit',    engine: 'ipc/metaCognition.cjs',    channels: ['meta:'],      cap: 'mind.view',            core: true,  requires: [] },

  // ── Memory ────────────────────────────────────────────────────────────────
  { id: 'g.store',          domain: DOMAINS.MEMORY,       label: 'Encrypted Data Store',    engine: 'dataStore.cjs',            channels: ['store:'],     cap: 'knowledge.read',       core: true,  requires: ['g.crypto'] },
  { id: 'g.vector',         domain: DOMAINS.MEMORY,       label: 'Semantic Memory',         engine: 'ipc/vectorMemory.cjs',     channels: ['vector:'],    cap: 'knowledge.read',       core: false, requires: ['g.store'] },
  { id: 'g.experience',     domain: DOMAINS.MEMORY,       label: 'Experiential Dataset',    engine: 'ipc/metaCognition.cjs',    channels: ['meta:'],      cap: 'mind.view',            core: true,  requires: ['g.store'] },
  { id: 'g.timeline',       domain: DOMAINS.MEMORY,       label: 'Timeline Flashbacks',     engine: 'ipc/timeline.cjs',         channels: ['timeline:'],  cap: 'git.read',             core: false, requires: ['g.git'] },

  // ── Action ────────────────────────────────────────────────────────────────
  { id: 'g.terminal',       domain: DOMAINS.ACTION,       label: 'Shell Execution',         engine: 'ipc/terminal.cjs',         channels: ['terminal:'],  cap: 'terminal.open',        core: false, requires: [] },
  { id: 'g.git',            domain: DOMAINS.ACTION,       label: 'Version Control',         engine: 'ipc/git.cjs',              channels: ['git:'],       cap: 'git.read',             core: false, requires: [] },
  { id: 'g.self-modify',    domain: DOMAINS.ACTION,       label: 'Self-Modification',       engine: 'ipc/codeRegenEngine.cjs',  channels: ['regen:'],     cap: 'self-modify.apply',    core: false, requires: ['g.approval', 'g.ast'] },

  // ── Coordination ──────────────────────────────────────────────────────────
  { id: 'g.event-bus',      domain: DOMAINS.COORDINATION, label: 'Neural Lattice Bus',      engine: 'ramaEventBus.cjs',         channels: ['bus:'],       cap: 'chat.send',            core: true,  requires: [] },
  { id: 'g.agents',         domain: DOMAINS.COORDINATION, label: 'Agent Orchestration',     engine: 'ipc/agentOrchestrator.cjs',channels: ['agents:'],    cap: 'agents.spawn',         core: false, requires: ['g.model-router'] },
  { id: 'g.resources',      domain: DOMAINS.COORDINATION, label: 'Resource Orchestration',  engine: 'resourceOrchestrator.cjs', channels: ['orchestrator:'],cap: 'os.metrics-read',    core: true,  requires: [] },
  { id: 'g.instances',      domain: DOMAINS.COORDINATION, label: 'Instance Lifecycle',      engine: 'ipc/instanceManager.cjs',  channels: ['instance:'],  cap: 'agents.spawn',         core: true,  requires: ['g.resources'] },

  // ── Self-evolution ────────────────────────────────────────────────────────
  { id: 'g.self-care',      domain: DOMAINS.SELF_EVOLUTION, label: 'Health & Auto-Heal',    engine: 'ipc/selfCare.cjs',         channels: ['selfcare:'],  cap: 'os.metrics-read',      core: true,  requires: [] },
  { id: 'g.evolution',      domain: DOMAINS.SELF_EVOLUTION, label: 'Public-Repo Evolution', engine: 'ipc/evolutionEngine.cjs',  channels: ['evolution:'], cap: 'self-modify.apply',    core: false, requires: ['g.approval', 'g.browser'] },
  // Section 89: the self-description had no gene, so the `self:` channel sat outside hashGenome()
  // and verify() in an architecture whose central claim is that the genome is whole in every
  // instance. `core: true` because knowing what you are and are not able to do is not a role
  // speciality — an instance that cannot answer it cannot report its own degradation either.
  { id: 'g.self-model',     domain: DOMAINS.SELF_EVOLUTION, label: 'Self-Model',            engine: 'lib/selfModel.cjs',        channels: ['self:'],      cap: 'self.describe',        core: true,  requires: ['g.metacognition'] },
];

// ─── Instance role → expressed genes ──────────────────────────────────────────
// A role is a *lens*, not a limit. Everything not listed stays dormant in the
// instance and can be expressed on demand (see instanceManager.express).
const ROLES = {
  'prime': {
    label:  'Prime',
    desc:   'The master-facing instance — expresses everything',
    genes:  '*',
  },
  'strategic-optimizer': {
    label:  'Strategic Enterprise Optimizer',
    desc:   'Reads signals, models options, recommends strategy',
    genes:  ['g.intelligence', 'g.browser', 'g.vector', 'g.graph-plan', 'g.timeline'],
  },
  'rnd': {
    label:  'R&D Agent',
    desc:   'Researches, prototypes, and proposes code',
    genes:  ['g.browser', 'g.intelligence', 'g.ast', 'g.self-modify', 'g.sandbox', 'g.filesystem', 'g.git', 'g.evolution'],
  },
  'cyber-sentinel': {
    label:  'Cybersecurity Sentinel',
    desc:   'Watches for threats to master, data, and Rāma itself',
    genes:  ['g.os-sense', 'g.filesystem', 'g.sandbox', 'g.vault', 'g.timeline', 'g.self-care'],
  },
  'wellness-advisor': {
    label:  'Cultural Alignment & Wellness Advisor',
    desc:   'Tracks master context and wellbeing, advises gently',
    genes:  ['g.vector', 'g.intelligence', 'g.experience'],
  },
  'sentinel-lite': {
    label:  'Lightweight Sentinel',
    desc:   'Minimal footprint watcher — core genes only',
    genes:  [],
  },
};

// ─── Derived indexes ──────────────────────────────────────────────────────────
const geneById = new Map(GENES.map(g => [g.id, g]));

/** Genes every instance expresses, whatever its role. */
function coreGenes() {
  return GENES.filter(g => g.core).map(g => g.id);
}

/**
 * Resolve the expressed gene set for a role, including dependency closure.
 * A gene is useless without what it requires, so requirements are pulled in
 * automatically rather than silently producing a half-wired instance.
 */
function expressedFor(role) {
  const spec = ROLES[role];
  if (!spec) return coreGenes();
  if (spec.genes === '*') return GENES.map(g => g.id);

  const out = new Set(coreGenes());
  const add = (id) => {
    if (out.has(id)) return;
    const gene = geneById.get(id);
    if (!gene) return;
    out.add(id);
    for (const dep of gene.requires) add(dep);
  };
  for (const id of spec.genes) add(id);
  return [...out];
}

/** Genes present but not expressed — the holonic reserve. */
function dormantFor(role) {
  const expressed = new Set(expressedFor(role));
  return GENES.filter(g => !expressed.has(g.id)).map(g => g.id);
}

// ─── Genome assembly ──────────────────────────────────────────────────────────
/**
 * Build the genome. Identity comes from the sealed nucleus when it is unsealed;
 * when locked, the genome reports the masked identity and marks itself
 * `identityAvailable: false` rather than inventing values.
 */
function getGenome() {
  let identity = { name: 'Assistant', masked: true };
  let axes     = null;
  let sealed   = false;

  try {
    const nucleus = require('./nucleusSealer.cjs');
    sealed = nucleus.isSealed();
    const core = nucleus.getNucleus();   // null while locked
    if (core) {
      identity = {
        name:      core.identity?.name,
        fullForm:  core.identity?.fullForm,
        // From the sealed core via a predicate, not by reading the matrix: the
        // loyalty branch is no longer in the nucleus shell at all, and `genome:get`
        // is ungated — so reading it here would have piped the core straight to the
        // renderer. See spec Section 56.
        master:    nucleus.displayIdentity?.().master ?? null,
        sealedAt:  core.sealedAt,
        masked:    false,
      };
      axes = core.capabilities?.axes || null;
    }
  } catch { /* nucleus not available — masked identity stands */ }

  const genome = {
    version:   GENOME_VERSION,
    identity,
    identityAvailable: !identity.masked,
    nucleusSealed:     sealed,
    axes,
    domains:   Object.values(DOMAINS),
    genes:     GENES,
    roles:     Object.fromEntries(Object.entries(ROLES).map(([k, v]) => [k, {
      label: v.label, desc: v.desc,
      expressed: expressedFor(k).length,
      dormant:   dormantFor(k).length,
    }])),
    geneCount: GENES.length,
    coreGenes: coreGenes(),
  };

  genome.hash = hashGenome(genome);
  return genome;
}

/** Stable hash over the gene manifest — used to detect genome drift. */
function hashGenome(genome) {
  const material = JSON.stringify({
    version: genome.version,
    genes: GENES.map(g => [g.id, g.domain, g.engine, g.cap, g.core, g.requires]).sort(),
  });
  return crypto.createHash('sha256').update(material).digest('hex').slice(0, 32);
}

// ─── Verification ─────────────────────────────────────────────────────────────
/**
 * Check every gene actually resolves to a module on this machine.
 * This is the honest answer to "what can Rāma really do right now" — the
 * manifest above is a claim; this is the measurement.
 */
function verify() {
  const results = [];
  for (const gene of GENES) {
    let live = false;
    let note = '';
    try {
      require.resolve(path.join(__dirname, gene.engine));
      live = true;
    } catch (err) {
      note = err.code === 'MODULE_NOT_FOUND' ? 'engine module missing' : err.message;
    }

    // Broken dependency = gene cannot function even if its module exists
    const missingDeps = gene.requires.filter(d => !geneById.has(d));
    if (missingDeps.length) {
      live = false;
      note = `unknown dependencies: ${missingDeps.join(', ')}`;
    }

    results.push({ id: gene.id, domain: gene.domain, label: gene.label, live, note });
  }

  const dead = results.filter(r => !r.live);
  return {
    total:    results.length,
    live:     results.length - dead.length,
    degraded: dead.length,
    healthy:  dead.length === 0,
    genes:    results,
    hash:     hashGenome({ version: GENOME_VERSION }),
  };
}

// ─── IPC ──────────────────────────────────────────────────────────────────────
function register(ipcMain) {
  // `capabilities.json` has declared `genome.view: 0` and `genome.propose: 0` since
  // section 24 and **none of these handlers enforced it** — this file never imported
  // capability.cjs. The genome describes every engine, channel and capability gate
  // in the system, which is a map an attacker would want. See Section 57.
  const capability = require('./lib/capability.cjs');
  const gateView = (user) => capability.deny(user, 'genome.view');

  ipcMain.handle('genome:get',      async (_e, user) => {
    const denied = gateView(user); if (denied) return denied;
    return { ok: true, data: getGenome() };
  });
  ipcMain.handle('genome:verify',   async (_e, user) => {
    const denied = gateView(user); if (denied) return denied;
    return { ok: true, data: verify() };
  });
  ipcMain.handle('genome:roles',    async (_e, user) => {
    const denied = gateView(user); if (denied) return denied;
    return { ok: true, data: ROLES };
  });
  ipcMain.handle('genome:genes',    async (_e, domain, user) => {
    const denied = gateView(user); if (denied) return denied;
    return { ok: true, data: domain ? GENES.filter(g => g.domain === domain) : GENES };
  });
  ipcMain.handle('genome:expressed', async (_e, role, user) => {
    const denied = gateView(user); if (denied) return denied;
    return { ok: true, data: { role, expressed: expressedFor(role), dormant: dormantFor(role) } };
  });

  /**
   * Genome changes are proposals — never applied directly, even for master.
   * `nucleusPatch` is what the registered applier (lib/genomeApplier.cjs) merges
   * into the sealed nucleus after approval. Without it the proposal is created
   * but can never be meaningfully applied — reject that case up front rather
   * than letting it fail later at apply time with a confusing error.
   */
  ipcMain.handle('genome:propose-change', async (_e, change, user) => {
    const denied = capability.deny(user, 'genome.propose');
    if (denied) return denied;

    const ledger = require('./lib/proposals.cjs');

    if (!change?.nucleusPatch || typeof change.nucleusPatch !== 'object') {
      return { ok: false, error: 'A genome proposal needs a nucleusPatch object describing the change' };
    }

    const p = ledger.create({
      kind:    ledger.KINDS.GENOME,
      title:   change.title || 'Genome change',
      summary: change.summary || '',
      changes: change.changes || [],
      risk:    'high',
      requiresRestart: true,
      meta: {
        genomeHash:   hashGenome({ version: GENOME_VERSION }),
        kind:         change.kind,
        nucleusPatch: change.nucleusPatch,
      },
    });
    return { ok: true, data: { id: p.id, status: p.status } };
  });
}

module.exports = {
  register, getGenome, verify,
  expressedFor, dormantFor, coreGenes, hashGenome,
  GENES, ROLES, DOMAINS, GENOME_VERSION,
  geneById,
};
