# What this project can honestly pursue

Given `00`–`02`, AGI/ASI are not reachable from an orchestration app, by
anyone, not just this project — that is an open problem for the whole field.
What *is* real and buildable is the corrected principle from
`01-scalability-reality-check.md`: capability that adapts honestly to
whatever infrastructure is actually reachable, reported truthfully, never
assumed. This file lists concrete, incremental directions in that spirit,
graded by how much of the existing codebase they'd extend versus require new
subsystems.

Every item below is written the way `RAMA_AGI_MASTER_SPEC.md` Section 30
("progressive capability ladder") already requires: level 0 needs nothing,
climbing is detected not assumed, the current level is always visible in the
UI. None of these are proposed as AGI/ASI steps — they are ordinary,
honestly-labelled engineering that happens to sit in the same territory the
field's real research occupies.

## 1. Extend the model router's elastic-inference pattern to compute tiers,
## not just providers

**What exists:** `modelRouter.cjs` already picks local-vs-cloud based on
credential/availability detection.

**What could be added:** detect *hardware* tier too — GPU presence
(`systeminformation` already reports this), available RAM, whether a
larger local model would fit — and let task routing consider "can this
machine actually run a bigger local model well" alongside "is a cloud key
present." This is squarely inside the elastic-inference research area
(`01`'s citations) and extends code that already exists rather than adding a
new subsystem.

**Honest scope:** this changes *which existing model* gets called and how
much of it runs locally vs. remotely. It does not make any model smarter.

## 2. Let `refineOutput()`'s self-scoring loop scale with available budget,
## not a fixed 3 iterations

**What exists:** `agentOrchestrator.refineOutput()` — bounded 3-iteration
self-critique against two honest metrics.

**What could be added:** make the iteration cap a function of
`resourceOrchestrator`'s live snapshot and, for cloud calls, an explicit
cost/time budget master sets — more self-critique passes when the machine
and budget allow it, fewer when they don't. This is a direct, small
instance of test-time-scaling-as-resource-rationality
(`02`, [arXiv:2602.10329](https://arxiv.org/pdf/2602.10329)), stated
honestly as "spend more inference compute when available," not as capability
growth.

**Honest scope:** more attempts at a better answer from the same model, nothing more.

## 3. Report the actual capability ceiling in the UI, tied to real resource
## state — not a static list

**What exists:** `capabilityReport()` in `start.cjs` already reports what's
degraded at boot. `resourceOrchestrator`'s live CPU/RAM/thermal snapshot
already exists.

**What could be added:** a persistent "what Rāma can do right now, and why"
panel that changes live as resources change — e.g., "local model available,
cloud model available, agent concurrency capped at N by current RAM" —
rather than only surfacing this at boot or on admission failure. This is
purely a truthful-reporting feature, the same discipline as the boot
diagnostic page (`main.cjs`'s `bootFailurePage`) applied continuously instead
of only on failure.

## 4. If a genuine quantum SDK becomes relevant to a specific subproblem,
## treat it exactly like any other external API — never as a blanket
## capability

If, someday, a specific subroutine in this project (e.g., a particular
optimization or search step) has a published quantum algorithm with a proven
advantage, and a cloud quantum SDK (IBM Quantum, Amazon Braket, etc.) exposes
it, that would be integrated the same way `marketIntel.cjs` integrates the
Python prediction engine or `modelRouter.cjs` integrates an LLM provider —
one bounded capability, gated, reported honestly, with a classical fallback
always present per invariant I11 ("upgrades are additive, every new engine
has a working fallback"). This is explicitly **not** "Rāma runs on a quantum
computer" — it would be one narrow function call to a quantum co-processor
for one specific problem, no different in kind from any other external
resource this project already integrates.

## What NOT to do, on the evidence in `00`–`02`

- Do not add a "consciousness," "ASI level," or capability-percentage metric
  to any UI or spec — this project's own `docs/rama-capability-audit.html`
  already identified and rejected exactly this pattern once (the
  `jarvis_x_core.py` "LPM/Ps/ASI level" language from the StockMind
  absorption, Section 39 of the master spec: real Python, ordinary
  control-flow, dramatic naming with no mechanism behind the numbers).
- Do not remove or weaken `proposals.cjs`'s human-approval gate in the name
  of "more autonomous self-improvement" — the alignment-safety literature
  treats that gate as the correct design, not a limitation
  ([arXiv:2603.06333](https://arxiv.org/abs/2603.06333)).
- Do not describe elastic/adaptive routing extensions (item 1–3 above) as
  steps toward AGI/ASI in code comments, UI copy, or spec sections. They are
  resource-rational orchestration improvements — real, useful, and
  accurately described as exactly that.
