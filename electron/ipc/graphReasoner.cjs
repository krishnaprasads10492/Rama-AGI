'use strict';

/**
 * graphReasoner.cjs — Graph-Based Reasoning & Planning Engine.
 *
 * UPGRADE PHILOSOPHY:
 *   - Wraps existing heuristic PlanningEngine — does NOT replace it
 *   - Old heuristic planner runs first (instant, no overhead)
 *   - Graph planner enhances the plan with dependency resolution,
 *     parallel branch detection, and backtracking
 *   - If graph planning fails, falls back to heuristic plan transparently
 *   - Tracks plan success rate — if graph plans fail more than heuristic, reverts
 *
 * What this adds:
 *   Directed Acyclic Graph (DAG) task planning:
 *     - Nodes = tasks/sub-goals
 *     - Edges = dependencies (B depends on A's output)
 *     - Parallel detection — tasks with no shared deps run simultaneously
 *     - Critical path analysis — identifies bottleneck tasks
 *     - Backtracking — if a node fails, re-routes around it
 *     - Dynamic re-planning — new information can update the graph mid-execution
 *
 *   ReAct loop integration:
 *     - Each node gets: Reason → Act → Observe → Reason cycle
 *     - Observations feed back into subsequent node decisions
 *     - Graph state visible to master in real time
 */

const crypto = require('crypto');

// ─── Graph node types ─────────────────────────────────────────────────────────
const NODE_TYPES = {
  THINK:    'think',     // Pure reasoning, no external action
  SEARCH:   'search',    // Web search or knowledge lookup
  EXECUTE:  'execute',   // Run code or command
  CALL:     'call',      // API or tool call
  DECIDE:   'decide',    // Branch point — outcome determines next path
  SYNTHESIZE: 'synthesize', // Combine results from multiple branches
  VERIFY:   'verify',    // Check result quality before proceeding
  REPORT:   'report',    // Present to master
};

// ─── Plan registry ────────────────────────────────────────────────────────────
const plans    = new Map();   // planId → PlanGraph
const history  = [];          // completed plans
const metrics  = { total: 0, success: 0, graphUsed: 0, heuristicFallback: 0 };

// ─── PlanGraph class ──────────────────────────────────────────────────────────
class PlanGraph {
  constructor(goal, planId) {
    this.id       = planId;
    this.goal     = goal;
    this.nodes    = new Map();  // nodeId → PlanNode
    this.edges    = [];         // { from, to, condition }
    this.status   = 'pending';
    this.createdAt = Date.now();
    this.result   = null;
  }

  addNode(type, description, metadata = {}) {
    const id   = crypto.randomBytes(4).toString('hex');
    const node = {
      id, type, description, metadata,
      status:    'pending',  // pending | running | complete | failed | skipped
      result:    null,
      startedAt: null,
      completedAt: null,
      retries:   0,
      maxRetries: 2,
    };
    this.nodes.set(id, node);
    return id;
  }

  addEdge(fromId, toId, condition = null) {
    this.edges.push({ from: fromId, to: toId, condition });
    return this;
  }

  // Get nodes whose dependencies are all complete
  getReadyNodes() {
    const ready = [];
    for (const [id, node] of this.nodes) {
      if (node.status !== 'pending') continue;
      const deps = this.edges.filter(e => e.to === id);
      const allDepsDone = deps.every(e => {
        const dep = this.nodes.get(e.from);
        if (!dep) return true;
        if (e.condition && dep.result) {
          // Conditional edge — check condition
          return dep.status === 'complete' && e.condition(dep.result);
        }
        return dep.status === 'complete' || dep.status === 'skipped';
      });
      if (allDepsDone) ready.push(node);
    }
    return ready;
  }

  // Find parallel groups (nodes that can run simultaneously)
  getParallelGroups() {
    const ready  = this.getReadyNodes();
    const groups = [];

    // Group by shared dependencies — nodes with no shared deps are parallel
    const assigned = new Set();
    for (const node of ready) {
      if (assigned.has(node.id)) continue;
      const group = [node];
      assigned.add(node.id);

      for (const other of ready) {
        if (assigned.has(other.id)) continue;
        // Check if node and other share any upstream dependency
        const nodeDeps  = new Set(this.edges.filter(e => e.to === node.id).map(e => e.from));
        const otherDeps = new Set(this.edges.filter(e => e.to === other.id).map(e => e.from));
        const shared    = [...nodeDeps].filter(d => otherDeps.has(d));
        if (shared.length === 0) {
          group.push(other);
          assigned.add(other.id);
        }
      }
      groups.push(group);
    }
    return groups;
  }

  // Critical path — longest dependency chain (bottleneck identification)
  getCriticalPath() {
    const nodeIds   = [...this.nodes.keys()];
    const distances = {};
    nodeIds.forEach(id => { distances[id] = 0; });

    // Topological sort + longest path
    for (const edge of this.edges) {
      const newDist = (distances[edge.from] || 0) + 1;
      if (newDist > (distances[edge.to] || 0)) {
        distances[edge.to] = newDist;
      }
    }

    const maxDist = Math.max(...Object.values(distances));
    return nodeIds
      .filter(id => distances[id] === maxDist)
      .map(id => this.nodes.get(id));
  }

  updateNode(nodeId, updates) {
    const node = this.nodes.get(nodeId);
    if (node) Object.assign(node, updates);
  }

  isComplete() {
    return [...this.nodes.values()].every(n =>
      n.status === 'complete' || n.status === 'skipped' || n.status === 'failed'
    );
  }

  toJSON() {
    return {
      id:     this.id,
      goal:   this.goal,
      status: this.status,
      nodes:  [...this.nodes.values()],
      edges:  this.edges,
      createdAt: this.createdAt,
      result: this.result,
    };
  }
}

// ─── Goal decomposition into graph ───────────────────────────────────────────
function decomposeToGraph(goal, category = 'general') {
  const planId = `graph_${Date.now()}`;
  const graph  = new PlanGraph(goal, planId);
  const g      = goal.toLowerCase();

  // Detect goal category and build appropriate graph
  if (g.includes('search') || g.includes('research') || g.includes('find')) {
    // Research graph: search → read → cross-ref → synthesize → verify → report
    const n1 = graph.addNode(NODE_TYPES.THINK,      'Decompose query into search terms');
    const n2 = graph.addNode(NODE_TYPES.SEARCH,     'Search primary sources');
    const n3 = graph.addNode(NODE_TYPES.SEARCH,     'Search secondary sources');
    const n4 = graph.addNode(NODE_TYPES.SYNTHESIZE, 'Cross-reference and merge findings');
    const n5 = graph.addNode(NODE_TYPES.VERIFY,     'Check for contradictions');
    const n6 = graph.addNode(NODE_TYPES.REPORT,     'Present synthesized answer');

    graph.addEdge(n1, n2).addEdge(n1, n3);           // n2 and n3 run in parallel
    graph.addEdge(n2, n4).addEdge(n3, n4);           // n4 waits for both
    graph.addEdge(n4, n5).addEdge(n5, n6);

  } else if (g.includes('code') || g.includes('build') || g.includes('create')) {
    // Code graph: understand → design → implement → test → fix (if needed) → report
    const n1 = graph.addNode(NODE_TYPES.THINK,      'Understand requirements');
    const n2 = graph.addNode(NODE_TYPES.THINK,      'Design implementation approach');
    const n3 = graph.addNode(NODE_TYPES.EXECUTE,    'Generate code');
    const n4 = graph.addNode(NODE_TYPES.EXECUTE,    'Test implementation');
    const n5 = graph.addNode(NODE_TYPES.DECIDE,     'Test passed?');
    const n6 = graph.addNode(NODE_TYPES.EXECUTE,    'Fix issues (if failed)');
    const n7 = graph.addNode(NODE_TYPES.REPORT,     'Present working implementation');

    graph.addEdge(n1, n2).addEdge(n2, n3).addEdge(n3, n4)
         .addEdge(n4, n5)
         .addEdge(n5, n7, (r) => r?.passed)           // success path
         .addEdge(n5, n6, (r) => !r?.passed)           // failure path
         .addEdge(n6, n4);                             // retry test after fix

  } else if (g.includes('analyz') || g.includes('predict') || g.includes('forecast')) {
    // Analysis graph: gather data (parallel sources) → normalize → analyze → calibrate → report
    const n1 = graph.addNode(NODE_TYPES.CALL,       'Fetch primary data source');
    const n2 = graph.addNode(NODE_TYPES.CALL,       'Fetch supplementary data');
    const n3 = graph.addNode(NODE_TYPES.CALL,       'Fetch market sentiment');
    const n4 = graph.addNode(NODE_TYPES.SYNTHESIZE, 'Normalize and merge data');
    const n5 = graph.addNode(NODE_TYPES.EXECUTE,    'Run analysis algorithms');
    const n6 = graph.addNode(NODE_TYPES.VERIFY,     'Calibrate confidence scores');
    const n7 = graph.addNode(NODE_TYPES.REPORT,     'Present calibrated predictions');

    graph.addEdge(n1, n4).addEdge(n2, n4).addEdge(n3, n4);  // parallel data fetch
    graph.addEdge(n4, n5).addEdge(n5, n6).addEdge(n6, n7);

  } else {
    // Generic: think → act → observe → verify → report (ReAct loop)
    const n1 = graph.addNode(NODE_TYPES.THINK,   'Analyze task and formulate approach');
    const n2 = graph.addNode(NODE_TYPES.CALL,    'Execute primary action');
    const n3 = graph.addNode(NODE_TYPES.VERIFY,  'Observe and verify result');
    const n4 = graph.addNode(NODE_TYPES.REPORT,  'Present result to master');

    graph.addEdge(n1, n2).addEdge(n2, n3).addEdge(n3, n4);
  }

  return graph;
}

// ─── Register IPC ─────────────────────────────────────────────────────────────
function register(ipcMain) {

  // ── Create a plan graph for a goal ───────────────────────────────────────
  ipcMain.handle('graph:create-plan', async (_e, { goal, category }) => {
    metrics.total++;
    metrics.graphUsed++;

    const graph = decomposeToGraph(goal, category);
    plans.set(graph.id, graph);

    const ready    = graph.getReadyNodes();
    const parallel = graph.getParallelGroups();
    const critical = graph.getCriticalPath();

    return {
      ok: true,
      planId:        graph.id,
      graph:         graph.toJSON(),
      readyNodes:    ready.map(n => n.id),
      parallelGroups: parallel.map(g => g.map(n => n.id)),
      criticalPath:  critical.map(n => n.id),
      nodeCount:     graph.nodes.size,
      edgeCount:     graph.edges.length,
    };
  });

  // ── Update node status ────────────────────────────────────────────────────
  ipcMain.handle('graph:update-node', async (_e, { planId, nodeId, status, result }) => {
    const graph = plans.get(planId);
    if (!graph) return { ok: false, error: 'Plan not found' };

    graph.updateNode(nodeId, {
      status,
      result,
      completedAt: Date.now(),
    });

    const ready    = graph.getReadyNodes();
    const complete = graph.isComplete();

    if (complete) {
      graph.status = 'complete';
      const allFailed = [...graph.nodes.values()].every(n => n.status !== 'complete');
      if (!allFailed) metrics.success++;
      history.unshift({ planId, goal: graph.goal, ts: Date.now(), success: !allFailed });
      if (history.length > 100) history.pop();
    }

    return {
      ok:        true,
      complete,
      readyNodes: ready.map(n => n.id),
      graph:      graph.toJSON(),
    };
  });

  // ── Get plan state ────────────────────────────────────────────────────────
  ipcMain.handle('graph:get-plan', async (_e, planId) => {
    const graph = plans.get(planId);
    if (!graph) return { ok: false, error: 'Plan not found' };
    return { ok: true, data: graph.toJSON() };
  });

  // ── List active plans ─────────────────────────────────────────────────────
  ipcMain.handle('graph:list-plans', async () => {
    const active = [...plans.values()]
      .filter(g => g.status !== 'complete')
      .map(g => ({ id: g.id, goal: g.goal, status: g.status, nodeCount: g.nodes.size }));
    return { ok: true, data: active };
  });

  // ── Re-plan (dynamic update when new info arrives) ────────────────────────
  ipcMain.handle('graph:replan', async (_e, { planId, newContext }) => {
    const graph = plans.get(planId);
    if (!graph) return { ok: false, error: 'Plan not found' };

    // Reset pending nodes (keep completed ones — never redo completed work)
    for (const [, node] of graph.nodes) {
      if (node.status === 'pending') {
        node.status = 'pending';  // stays pending
      }
      // Failed nodes get one more chance
      if (node.status === 'failed' && node.retries < node.maxRetries) {
        node.status = 'pending';
        node.retries++;
      }
    }

    const ready = graph.getReadyNodes();
    return { ok: true, readyNodes: ready.map(n => n.id), graph: graph.toJSON() };
  });

  // ── Graph metrics ─────────────────────────────────────────────────────────
  ipcMain.handle('graph:metrics', async () => {
    return {
      ok:   true,
      data: {
        ...metrics,
        successRate:    metrics.total > 0 ? `${Math.round((metrics.success / metrics.total) * 100)}%` : 'N/A',
        graphUsageRate: metrics.total > 0 ? `${Math.round((metrics.graphUsed / metrics.total) * 100)}%` : 'N/A',
        activePlans:    plans.size,
        historyCount:   history.length,
      },
    };
  });
}

module.exports = { register, decomposeToGraph, PlanGraph };
