# ASI research notes

This folder is honest research, not a design spec for something the codebase
is going to build. It exists to answer, with citations and reasoning rather
than assertion, the question master asked: is ASI (or AGI) actually reachable
from this project, and what does "scalable from a laptop to a quantum
computer" really mean.

## Files

- `00-terms-and-scope.md` — what AGI/ASI actually mean, how they differ from
  what LLM-orchestration apps (including Rāma) do today, and where the
  current field genuinely stands (2026).
- `01-scalability-reality-check.md` — the corrected framing master gave:
  capability should adapt to whatever infrastructure is actually reachable
  (a real, cited research area — elastic inference / resource-rational
  intelligence), which is different from "the same program runs on a laptop
  and on a quantum computer" (which isn't how quantum hardware works). Both
  are laid out so the distinction is explicit.
- `02-pathways-from-literature.md` — the real research directions the field
  is pursuing toward more general/capable AI (scaling, recursive
  self-improvement, test-time compute, multi-agent collectives), what each
  one actually requires, and which of those requirements this project could
  or could not meet even in principle.
- `03-what-this-project-can-honestly-pursue.md` — given the above, what
  incremental, real, buildable research directions are actually available to
  Rāma as a project, without re-labelling ordinary engineering as ASI
  progress.

## Ground rule for anything added here later

Every claim in this folder must trace to either (a) a citation to published
research, or (b) a specific file/function in this codebase. No invented
metrics, no "infinite scaling," no capability claimed without a mechanism
that could produce it. This is the same discipline
`docs/rama-capability-audit.html` already holds the rest of the project to —
this folder does not get an exemption because the topic is more ambitious.
