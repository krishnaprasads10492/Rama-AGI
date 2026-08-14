# Scalability reality check

## Master's clarification (superseding the literal "laptop scales to a
## quantum computer" framing)

The intent is not that the *same program* grows into a quantum computer. The
intent is: **Rāma should size its own capability to whatever infrastructure
it is currently running on** — light and local on modest hardware, heavier
and more capable when better hardware or cloud/quantum resources are
reachable — rather than being written for one fixed hardware assumption.

That reframing is sound and maps to a real, well-studied idea, not a
hand-wave. It has a name in two different literatures:

- **Elastic / adaptive inference** (systems research): a serving system that
  "dynamically adjusts its computational footprint, memory usage, precision,
  parallelism, or hardware allocation in response to changing resource
  constraints" — this is an active, named research area, not a metaphor
  ([EmergentMind survey](https://www.emergentmind.com/topics/elastic-inference);
  cloud-edge elastic adaptation:
  [arXiv:2402.17316](https://arxiv.org/html/2402.17316v1); multi-device
  elastic LLM inference on edge hardware:
  [arXiv:2607.07046](https://arxiv.org/abs/2607.07046)).
- **Resource-rational intelligence** (cognitive science / AI theory):
  intelligence itself is modeled as "the optimal use of limited
  computational resources" — an agent is judged intelligent relative to what
  it does *given its actual constraints*, not against some resource-unbounded
  ideal (Lieder & Griffiths,
  [Behavioral and Brain Sciences](https://cocosci.princeton.edu/papers/Resource-rational_analysis.pdf);
  Gershman lab review,
  [Bhui et al.](https://gershmanlab.com/pubs/Bhui21.pdf)). A 2026 paper
  explicitly reframes LLM test-time scaling itself as an instance of adaptive
  resource-rationality — spending more inference compute when it's available
  and worth it, less when it isn't
  ([arXiv:2602.10329](https://arxiv.org/pdf/2602.10329)).

Put together: **"adapting capability to available infrastructure" is a more
accurate and more defensible definition of practical intelligence than
"runs the same way regardless of hardware."** This is worth keeping as the
project's stated design principle, correcting the earlier "laptop scales up
to a quantum computer" phrasing, which described program portability, not
adaptive capability.

## Why "the same code scales from a laptop to a quantum computer" doesn't
## hold, and why that distinction matters

This is not pedantry — conflating the two leads to real design mistakes if
left unexamined:

1. **Different problem, not more of the same problem.** A quantum computer
   is not "a bigger classical computer." It is a fundamentally different
   computational model (qubits, superposition, entanglement) that gives a
   proven asymptotic advantage on a *specific, narrow* class of problems —
   factoring, certain simulation and optimization problems, some search
   problems — and no advantage at all on most ordinary software tasks like
   parsing JSON, running a React UI, or calling an HTTP API
   ([Springer review of quantum systems and software, 2026](https://link.springer.com/10.1007/s11390-025-5953-3)).
   Code has to be *re-architected as a quantum algorithm* for the specific
   subproblem that benefits — it does not "run faster" by being deployed onto
   different hardware, the way a Node.js app can move from a laptop to a
   bigger cloud VM.
2. **Quantum computers are not a general-purpose target today, and won't be
   soon.** Every 2026 review of the field agrees on the same set of open
   problems: noise, decoherence, and limited qubit counts
   ([oarjpublication.com 2026](https://oarjpublication.com/journals/oarjet/sites/default/files/OARJET-2026-0054.pdf);
   [Nature, 2026](https://www.nature.com/articles/s41587-026-03233-x);
   [IEEE Spectrum](https://spectrum.ieee.org/quantum-calibration-decoding)).
   IEEE Spectrum's summary is the clearest: for the foreseeable future,
   quantum computers are **hybrid devices that still need substantial
   classical hardware alongside them** for calibration and error correction
   — there is no scenario where an app "moves onto" a quantum computer the
   way it moves from a laptop to a server.
3. **What actually is portable across hardware tiers, and this is the real
   target:** an *orchestration layer* that detects what compute is reachable
   right now (a local Ollama model vs. no local model; a GPU vs. CPU-only; a
   cloud API credential present vs. absent; eventually, a quantum
   co-processor exposed through a cloud SDK for one specific subroutine) and
   routes each task to the best thing actually available — never a single
   monolithic program executing identically everywhere.

## What Rāma already has that is a genuine (if early) instance of this idea

- `electron/ipc/modelRouter.cjs`'s `checkAvailable()` / `selectModel()` /
  `FALLBACK_CHAIN` already do exactly the "detect what's actually reachable,
  then route" pattern — local Ollama models are checked first for
  `offline`-tagged tasks, cloud models are used only if a credential exists
  and is reachable. This is real elastic routing, just currently limited to
  "which LLM provider," not "which compute tier."
- `electron/resourceOrchestrator.cjs`'s `admit()` already gates every
  spawn on live CPU/RAM/thermal readings (`resourceOrchestrator.cjs:384-419`)
  rather than a fixed assumption — it already refuses work the current
  machine cannot afford, and reports *why*, rather than degrading silently.
- Both of these are the right shape for "capability that adapts to
  infrastructure" — see `03-what-this-project-can-honestly-pursue.md` for
  what extending this pattern further, honestly, would look like.

## The corrected principle, stated plainly

> Rāma's capability ceiling should be a function of what compute is actually
> reachable at runtime — local model, cloud model, GPU, or (in principle,
> far in the future) a specialized quantum subroutine reached through a
> normal API — selected and reported honestly, never assumed. This is a
> resource-rationality property of the *orchestration layer*, not a claim
> that Rāma's own code executes on, or benefits from, quantum hardware.
