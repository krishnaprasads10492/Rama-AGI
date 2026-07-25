import { create } from 'zustand';

/**
 * agentStore — Live agent state mirrored from IPC events.
 */
export const useAgentStore = create((set, get) => ({
  agents:           {},       // { [agentId]: agent }
  approvalQueue:    [],       // pending destructive actions needing master OK
  resources:        null,

  // ── Sync from IPC events ──────────────────────────────────────────────────
  upsertAgent: (agent) => set(s => ({
    agents: { ...s.agents, [agent.id]: agent },
  })),

  removeAgent: (id) => set(s => {
    const a = { ...s.agents };
    delete a[id];
    return { agents: a };
  }),

  addStep: (agentId, step) => set(s => {
    const agent = s.agents[agentId];
    if (!agent) return s;
    return {
      agents: {
        ...s.agents,
        [agentId]: { ...agent, steps: [...(agent.steps || []), step] },
      },
    };
  }),

  setResources: (r) => set({ resources: r }),

  // ── Approval queue ────────────────────────────────────────────────────────
  pushApproval: (item) => set(s => ({
    approvalQueue: [...s.approvalQueue, { ...item, id: Date.now() }],
  })),
  resolveApproval: (id) => set(s => ({
    approvalQueue: s.approvalQueue.filter(a => a.id !== id),
  })),
}));
