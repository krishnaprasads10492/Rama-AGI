# Jev — the short version

Companion to `JEV_EVALUATION.md` in this directory. Readable on its own. Every claim here is
in the full document; nothing new is asserted.

**What was evaluated:** **Jev**, the hosted "System One" typed-decision model from TypeSafe AI
(released 15 Sep 2026) — a model that returns a choice from an enumerated set, a rubric position, or
a yes/no probability, and never writes prose. **Not JEPA**, which is an unrelated self-supervised
*training* objective from the LeCun line of work, irrelevant to Rāma because Rāma trains nothing and
has no GPU. The two names collide and are easy to confuse.

---

## The recommendation

**Do not adopt hosted Jev. Build the pattern locally instead.**

Jev is a competent product. The problem is that **Rāma has nothing for it to displace.** The entire
financial and speed case rests on replacing LLM calls that do bounded classification — and Rāma makes
none. Every gate it has is deterministic code over declared data.

Take Jev's three good design rules and apply them with Ollama, which master already runs for free:

1. Enumerate the answer space in advance, **always including an explicit abstain option**.
2. Split one hard judgement into several easy ones and combine them in code.
3. Keep the final permission decision in code. The model proposes; the gate disposes.

---

## The numbers that matter

| Figure | Value | Provenance |
|---|---|---|
| Rāma decision points that invoke a model today | **0 of 21** | **MEASURED-HERE** — searched all 12 gate modules; no generative inference anywhere. `vectorMemory` makes a *local* embedding call only |
| Honest cost saving from Jev on existing gates | **0%** — the denominator is zero | **MEASURED-HERE**, derived from the row above |
| Decision points where a typed layer would *add* a missing judgement | **5 of 21 (23.8%)** | **MEASURED-HERE** — §4 inventory; denominator = 21 named decision points across 15 modules |
| Decision points where it would *regress* a provable rule | **7 of 21**, plus **3** barred by invariant | **MEASURED-HERE** — §4.2 |
| Vendor speed/cost claim | **up to 200x faster, 400x cheaper** | **VENDOR**, no independent corroboration at that magnitude |
| Independently measured speed | **5.43x** faster than Claude Haiku at p50 (126.81 ms vs 688.40 ms); **~2.2x** vs a nano-class LLM | **INDEPENDENT** — LiteLLM (240 calls/classifier, author-written labels, no blind adjudication) and ickma2311 |
| Independently measured cost | **96.1% lower** classifier cost (≈25x, not 400x); **$9.15 for 346,009 requests** | **INDEPENDENT** — LiteLLM; Deußer et al. (37 datasets, `jev-1.13.0` pinned) |
| Jev at Rāma's plausible volume | **≈ $10–20 per year** | **MEASURED-HERE**, arithmetic over the published $0.042/M input tokens |
| Master's hardware ceiling on local inference | **44.8 GB/s**, against 89.6 if the second RAM channel were populated | **MEASURED-HERE** — one 32 GB DIMM at 5600 MT/s, single-channel confirmed by row count; Core Ultra 5 135U, no discrete GPU |

**The 200x/400x pair does not survive independent measurement.** Two independent groups measured
ratios one to two orders of magnitude smaller. A meta-review of 28 early typed-decision papers found
the typed readout gives **no independent accuracy advantage** over an ordinary model scored by its
own option probabilities — the gains are latency and cost only.

---

## Hallucination: the distinction that is the whole answer

**Can it remove hallucination?** Partly, and narrowly.

- **It cannot fabricate prose**, because there is no free-text channel to fabricate into. True, and
  structurally guaranteed.
- **It can still be wrong**, and the independent audits measure *how*: exactly 1.0 confidence on
  **56.4%** of answers, nine of them wrong (n=2,412); stated 91.4% vs actual 76.1% accuracy on 8,801
  examples; calibration good on one task and poor on another in the same harness; accuracy
  **96.5% → 26.5%** under a single injected instruction (n=486, pre-registered). All INDEPENDENT.
- **"Cannot hallucinate" is not "cannot err."** A confidently wrong classification is still wrong.

**And Rāma already has the gates.** `claimGate` proves attribution mechanically — the cited source
must exist, and every numeral, date and name in the claim must appear in it. **Replacing a proof
with a judgement is a regression, not an upgrade**, and that applies to `claimGate`, `egressBoundary`
enforcement, `autonomyPolicy`, `capability` and `selfRepair`'s SHA check — the last being the
clearest regression of the lot.

**Master's "combo" instinct is right.** A typed layer upstream of a deterministic gate, with the LLM
doing prose inside the decided envelope, is the correct architecture. Rāma already has the
deterministic two-thirds of it. What is genuinely missing is the classifier on the front.

---

## The pilot

**A per-turn sensitivity producer for `egressBoundary` — built locally.** This is item 4 in master's
queue and it is a live hole, not a hypothetical one.

**MEASURED-HERE:** `src/pages/Chat/Chat.jsx:274` calls `converse` with no `sensitive` field;
`electron/ipc/modelRouter.cjs:515` defaults it to `false`; `grep sensitive src/**/*.jsx` returns
**zero matches**. So **every conversation turn crosses as non-sensitive today** — including a turn in
which master asks about his own position. The spec already admits the consequence (§131.6: the gate
refuses nothing in production).

**Build it as three layers that fail closed:** a deterministic prefilter on declared portfolio data →
a local Ollama call with a JSON Schema enum `{public, internal, private, unclear}` → `unclear` and
any failure both resolve to `private`. `conversationRole.sensitiveOrUnknown` already encodes that
asymmetry, so the seam exists.

**Why local and not Jev, in one line:** asking a third party whether a turn is private requires
sending the turn to the third party first. That is the thing the gate exists to prevent.

**Before Stage 1, do Stage 0:** add per-decision latency and token telemetry. None exists, which is
why no honest percentage of *cost* can be given today.

---

## The one decision only master can make

**May the Ollama-only scope be reversed?**

`RAMA_AGI_MASTER_SPEC.md` §130.9 (ledger row 150) fixes the scope at whatever a free ollama.com
account reaches, and nothing else — explicitly retracting the earlier Groq and Google
recommendations. **Hosted Jev is a proprietary paid endpoint reached via OpenRouter, so adopting it
reverses that decision.** The cost of reversing: a second vendor and key, the §130.9 retraction
partly undone, and §130.9's own conclusion contradicted — it states guardrail classification is
*not* a gap because `claimGate` already classifies with no model at all.

**If the answer is no, the question is closed and nothing else in the full document is needed.** The
recommendation above does not require the reversal.

---

## Blockers

1. **Scope.** Hosted Jev reverses a locked decision (above). Master's call, not mine.
2. **No self-hosted Jev exists.** The model runs on TypeSafe's servers; only the tooling is open.
   The open reconstructions reproduce the *interface*, not the weights or training.
3. **The PyTorch local path is dead on this machine.** `python --version` is **3.14.4**;
   `requirements.txt` pins `numpy==1.26.4`, which publishes no wheel above CPython 3.12. Rāma's own
   Python engine has never run here for exactly this reason. Add no discrete GPU and 44.8 GB/s of
   single-channel bandwidth. **MEASURED-HERE.**
4. **`egressBoundary` would need a third request `kind`.** Its `kind` is frozen to
   `['chat', 'search']` and `options` is enumerated, never spread — by design, and asserted by
   `scripts/verifyOllamaCloud.cjs`. Widening the one module whose value is its narrowness is a real
   cost. The local path needs no such change: `format` is already an enumerated option.
5. **No baseline telemetry.** There is no per-call cost or latency measurement in this codebase, so
   the percentage master asked for cannot be computed honestly yet. Bound, not point estimate:
   between 0% and 100%, most likely near zero because no gate calls a model.
6. **Abstention is non-negotiable and easy to get wrong.** Removing the abstain option took accuracy
   from 0.950 to 0.000 and ECE from 0.023 to 0.793 in one independent audit (n=11,759). Rāma's
   correct behaviour *is* withholding, so a decision layer without an explicit abstain value would
   convert "I don't know" into a confident guess.
7. **Never pin `jev-latest`.** The independent paper notes the vendor's aliases will move to newer
   versions. Any adoption pins `typesafe/jev-1.13`, or I12's pinning rule is satisfied in name only.

---

**Full analysis, inventory table and all 40-odd attributed sources:**
`.agents/tasks/jev-research/JEV_EVALUATION.md`

*Content was rephrased for compliance with licensing restrictions.*
