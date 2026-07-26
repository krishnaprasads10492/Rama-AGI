---
inclusion: always
---

# Rāma AGI — resume protocol

This project is built across many sessions. Sessions end, crash, or hit context
limits mid-task. There are many valid ways to build the same functionality, so
without a record of which way was chosen a later session re-decides differently
and breaks working code.

## Before doing anything

Read **SECTION 28 — BUILD LEDGER & RESUME PROTOCOL** in
`RAMA_AGI_MASTER_SPEC.md`. It holds:

- the **locked invariants** (I1–I14) that must not be changed without the master
  explicitly saying so
- the **ledger** of every task, its status, and the exact next step for anything
  unfinished
- the **resume checklist**

Then run `git log --oneline -8` to confirm which ledger rows are actually
committed, and `node start.cjs --diagnose` to see what the environment lacks.

## While working

1. **Research first.** For anything non-trivial, check current practice and the
   existing codebase before choosing an approach.
2. **Write the decision into the spec before implementing it**, not after.
3. Add the task to the ledger with status `in-progress` and its next concrete step.
4. On completing a step: mark it, and write the *next* step explicitly, so a cold
   session can resume from the document alone.
5. Never re-litigate a locked invariant. If one looks wrong, raise it rather than
   quietly changing it.

## Verification bar

- `node --check` on every `.cjs` touched
- diagnostics clean on every `.jsx` touched
- a behavioural test where the logic is security- or data-critical
- `node_modules` is **not** installed in this workspace, so `vite build` cannot be
  verified here. Say so plainly rather than claiming the build passes.

## Project conventions

- Commit format `type(scope): description`; push to **both** `dev` and `source`
- No `console.log` in shipped code — `console.warn` / `console.error` only
- Pinned dependency versions, no `^` or `~`
- No placeholders or TODOs in shipped code
- Master is Krishna Prasad. Rāma is loyal, benevolent, and transparent to master.
- Upgrades are additive: never remove a capability, always provide a fallback
