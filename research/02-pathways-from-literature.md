# Pathways from the literature, and what each actually requires

DeepMind's "From AGI to ASI" ([arXiv:2606.12683](https://arxiv.org/pdf/2606.12683))
names four pathways toward greater capability. Listed here with what each one
actually requires, and an honest note on which requirements this project can
or cannot meet — even in principle, regardless of effort spent.

## 1. Scaling (more training compute / more parameters)

**Requires:** access to train or fine-tune a model at meaningful scale —
GPU/TPU clusters, large curated datasets, and the capital to run both.

**Can Rāma do this:** no. Rāma has no training pipeline and no model of its
own; `modelRouter.cjs` calls other organizations' already-trained models over
HTTP. This pathway is closed to an orchestration app by definition — it
belongs to whoever trains the underlying models, not whoever calls them.

## 2. Test-time / inference-time scaling (more compute per query, at
## answer-time rather than train-time)

**Requires:** a model architecture that actually benefits from more
inference compute (not all do — see the "reasoning floor" finding,
[arXiv:2504.14047](https://arxiv.org/abs/2504.14047)), and a way to spend
that compute (longer chains of thought, multiple sampled attempts scored
against each other, tree/graph search over candidate reasoning paths).

**Can Rāma do this, partially:** yes, at the orchestration level, and this is
the most honestly achievable of the four for a project like this.
`agentOrchestrator.refineOutput()`'s bounded 3-iteration self-scoring loop is
already a small, real instance — generate, score, revise, stop. It could
legitimately be extended (more sampled attempts scored against each other
before returning one; letting master configure how much inference budget a
given query is worth) without ever claiming to be more than "spend more of
someone else's API compute, more deliberately." It does not make the
underlying model smarter — it uses the existing model harder and more
carefully, which is exactly what the research area studies.

## 3. Paradigm shift (a fundamentally different model architecture, not more
## of the current one)

**Requires:** genuine machine learning research — a new architecture that
generalizes differently than current transformer-based LLMs. This is what
"a different kind of system, not just a faster one" actually means in the
literature.

**Can Rāma do this:** no. This is upstream, foundational ML research. Nothing
in an Electron/Node.js orchestration app can produce a new model
architecture; adopting one, if the field produces it, would again mean
calling someone else's trained model through `modelRouter.cjs`, same as
today.

## 4. Recursive self-improvement (a system improving its own capability,
## which improves its ability to improve further)

**Requires**, per the most careful 2026 taxonomy of this
([arXiv:2607.07663](https://arxiv.org/abs/2607.07663)): the system must
(a) actually be able to modify something that changes its *underlying*
capability, not just its per-task output, (b) have a grounded way to
evaluate whether a self-modification is actually an improvement (not just
locally convincing), and (c) avoid the "collapse dynamics" the paper
documents — self-improvement loops that degrade or plateau rather than
compound, which is what the current evidence shows happening in practice
far more often than compounding gains.

**Can Rāma do this:** only the *bounded* half, and only with a human in the
loop, which is a deliberate design choice already made and recorded
(`RAMA_AGI_MASTER_SPEC.md` invariant I6, enforced by `proposals.cjs`). Rāma
can propose a patch to its own source (`evolutionEngine.cjs`,
`codeRegenEngine.cjs`); it cannot decide the patch is good and apply it
without master's explicit approval, and it has no mechanism to modify the
underlying LLM it calls — only its own orchestration code around that LLM.
This is bounded self-refinement in the taxonomy's terms, not open-ended RSI.
Alignment-safety research on RSI treats *removing* that human checkpoint as
the risk to manage, not a milestone to reach
([arXiv:2603.06333](https://arxiv.org/abs/2603.06333)) — so this project's
existing approval gate is not a limitation to engineer around, it is the
correct, literature-aligned design.

## The multi-agent collectives pathway (mentioned by DeepMind, not detailed
## above)

**Requires:** many capable agents coordinating such that the collective
exceeds any individual agent's capability — an open research question with
no established mechanism yet, per DeepMind's own framing.

**Can Rāma do this:** `agentOrchestrator.cjs`'s five agent types and
reputation-weighted scheduling are a genuine multi-agent system, but they
coordinate on task allocation and priority, not on producing capability
beyond what one call to one underlying model can produce. Calling this a
step toward the "ASI via collectives" pathway would overstate it; it is
ordinary task orchestration, done well.

## Summary table

| Pathway | Requires | Rāma can pursue it | What Rāma actually has |
|---|---|---|---|
| Scaling training compute | Train/fine-tune access, GPU clusters | No | Calls pre-trained models via API |
| Test-time scaling | Compute-hungry architecture + search/sampling | Partially | `refineOutput()` bounded self-scoring loop |
| Paradigm shift | New ML architecture research | No | N/A — not this kind of project |
| Recursive self-improvement | Autonomous eval + apply of self-changes | Bounded only | `proposals.cjs` requires human approval, by design |
| Multi-agent collectives | Coordination that exceeds individual capability | Partially, unproven | `agentOrchestrator.cjs` task scheduling, not capability emergence |
