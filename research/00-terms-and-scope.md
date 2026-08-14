# Terms and scope

## Definitions (not this project's invention — standard usage in the field)

- **ANI (Artificial Narrow Intelligence)** — a system that performs one task
  or a bounded family of tasks well, without transferring understanding to
  tasks it wasn't built or trained for. Every LLM API Rāma calls
  (`electron/ipc/modelRouter.cjs`), and Rāma itself, is in this category.
- **AGI (Artificial General Intelligence)** — a system that can learn and
  perform any intellectual task a human can, transferring understanding
  across domains without being specifically retrained for each one, with no
  known ceiling on what new problems it can pick up. No such system exists
  today at any lab, on any hardware.
- **ASI (Artificial Superintelligence)** — a system that exceeds the best
  human performance across virtually all cognitive domains, including
  research and self-improvement itself. Strictly beyond AGI; nothing
  resembling it exists.

Google DeepMind's own technical report on this ("From AGI to ASI",
[arXiv:2606.12683](https://arxiv.org/pdf/2606.12683)) frames ASI as something
reached only *after* AGI, via one of four pathways — scaling AGI, a paradigm
shift, recursive self-improvement, or large-scale multi-agent collectives —
and spends most of its length on the frictions and bottlenecks in each
pathway, not on a mechanism already working. That is the field's own most
AGI-optimistic lab describing this as unresolved, forward-looking research.

## Where the field actually stands (2026)

- Frontier LLMs are dramatically more capable than five years ago at
  language, code, and bounded reasoning tasks, largely through **more
  training compute** and, more recently, **more inference-time compute**
  ("test-time scaling" — letting a model "think longer" per query:
  [arXiv:2512.02008](https://arxiv.org/abs/2512.02008),
  [arXiv:2412.14352](https://arxiv.org/html/2412.14352v1)). This is real and
  is what makes modern chat models better than older ones at multi-step
  problems.
- That same test-time scaling research has found a **reasoning floor** — a
  performance plateau that a non-reasoning-architecture model cannot escape
  no matter how much extra inference compute is thrown at it
  ([arXiv:2504.14047](https://arxiv.org/abs/2504.14047)). More compute is not
  a substitute for a different kind of system; it has diminishing and
  eventually zero returns on the current architectures.
- **Recursive self-improvement (RSI)** — a system improving its own
  capability, which then improves its ability to improve itself — is being
  taken seriously as a research and safety topic, but the most careful 2026
  survey on it explicitly separates two things that get conflated in popular
  discussion:
  - **bounded self-refinement**: a model critiquing/revising its own output
    within one task, already industrial practice, convergent (it plateaus,
    it doesn't compound).
  - **open-ended RSI**: a system that improves its *own underlying
    capability* across tasks, which the same paper says "remains bounded by
    grounding requirements, collapse dynamics, and compute constraints on
    every side current evidence can measure"
    ([arXiv:2607.07663](https://arxiv.org/abs/2607.07663)).
  Rāma's `agentOrchestrator.refineOutput()` (bounded 3-iteration self-scoring
  loop against two honest metrics) and `evolutionEngine.cjs` (proposes code
  patches for master to approve) are real instances of the *first* kind —
  bounded self-refinement — not the second. This project's own capability
  audit (`docs/rama-capability-audit.html`) already draws exactly this line
  without using the RSI vocabulary.
- Alignment-safety research on RSI (e.g.
  [arXiv:2603.06333](https://arxiv.org/abs/2603.06333), on measuring and
  bounding "alignment drift" across self-modification cycles) treats
  unconstrained self-modification as a **risk to manage**, not a capability
  to maximize — every serious framework adds guardrails, caps, and human
  checkpoints, which is the same instinct behind this project's own
  `proposals.cjs` single-approval-ledger invariant (I6).

## What this means for Rāma specifically

Rāma is an ANI orchestration layer: it routes to other people's ANI systems
(OpenAI/Anthropic/Gemini/Groq/Mistral/Ollama), adds rule-based reflexes
(`cognition.js` tier 0), and can propose-but-not-autonomously-apply patches to
its own JavaScript. None of that is AGI, and the distance from ANI to AGI is
not a matter of more engineering effort on an orchestration layer — it is an
open research problem the entire field has not solved, using resources
(large labs, specialized hardware, years of research) far beyond what a
single desktop app can bring to bear. ASI is further still, and per
DeepMind's own framing, presupposes AGI already exists as a starting point.

This is not a reason to stop building Rāma — see
`03-what-this-project-can-honestly-pursue.md` for what real, smaller research
questions remain genuinely open to a project like this. It is a reason not to
describe orchestration and bounded self-refinement using AGI/ASI language.
