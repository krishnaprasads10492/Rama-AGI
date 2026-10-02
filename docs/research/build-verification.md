# Fetch-and-store, narrowed tranche — build verification

**Branch** `chart/fetch-and-store` · **worktree** `.worktrees/fetch-store` · **base** `9669eea`
**Date** 2026-10-02.

The design in `docs/research/FETCH_AND_STORE.md` did not converge over three review rounds (5 HIGH,
4 HIGH, 6 HIGH) because it covered six subsystems at once. The orchestrator cut the scope to three
items; all six remaining HIGH findings fall in the deferred parts, which are listed with their gating
finding ids in the design document's appended **DEFERRED BY THE ORCHESTRATOR** section. Nothing in
the design was altered.

---

## 1. What was built

### Item 1 — the missing props reach all three `PriceChart` call sites

There are exactly three call sites, and `coverage` reached one of them:

| Call site | Before | After |
| --- | --- | --- |
| `StockMind.jsx` chart tab (`<PriceChart`, line 956 after the edit) | `coverage={barsMeta ? {first, last} : null}` | `coverage` (now incl. `stored`), `replyNote`, `failure` |
| `StockMind.jsx` workspace panel (`render: () => <PriceChart`, line 865) | none of the three | `coverage`, `replyNote`, `failure` |
| `PopoutPanel.jsx` chart panel (line 173) | none of the three | `coverage`, `replyNote`, `failure` |

- All three new props are **optional with null defaults** (I11). `PriceChart` renders unchanged when
  given none of them, which is what keeps any future fourth call site working.
- `StockMind.jsx` now builds **one** `coverage` object in a `useMemo` and hands the same object to
  both of its charts. Two charts drawn from one reply previously bounded their date pickers
  differently, because only one of them had the data to bound them with.
- `coverage` gained `stored` (a count), because that is the single fact that separates item 2's two
  states. `coverage.last` is explicitly allowed to be `null`: the route omits `storedLastBar` in
  exactly the empty-window case (see §2).
- **The prop is `replyNote`, not `note`.** `PriceChart` already holds `const [note, setNote]` for the
  inline note editor; a prop named `note` is a redeclaration, and `scripts/auditRenderer.cjs` caught
  it as a parse error on the first run. The suite asserts the shorter name cannot return.
- **`meta` and `syncInfo` were NOT added.** See §2 — the route does send them, but nothing in the
  renderer reads them, and HIGH 5's lesson is that a prop no renderer reads is a contract waiting to
  be believed.

### Item 2 — the false headline is gone

`PriceChart.jsx` composed `No 30m bars stored for NIFTY50 over 1Y.` whenever the canvas was empty,
including when the store held 400 bars that simply did not intersect master's window — and offered
`⇩ Fetch & store them`, which cannot move bars into a window the provider does not serve.

The overlay's wording now comes from a new pure module, `src/pages/StockMind/chartEmptyState.js`,
whose `emptyState()` returns one of four states in this precedence:

| kind | trigger | headline | action |
| --- | --- | --- | --- |
| `fetching` | `busy` | `Fetching <label> bars for <SYM>…` | none |
| `failed` | a failed reply | the bridge's own sentence (reason + remedy) | `↻ Try again` |
| `nothing-in-window` | no bars, no failure, `coverage.stored > 0` | **the route's own note, verbatim** | `✕ clear dates` |
| `nothing-yet` | no bars, no failure, nothing stored | the Section 107 sentence, unchanged | `⇩ Fetch & store them` |

- The engine's note is **never suppressed**. In `nothing-in-window` it *is* the headline. When no note
  arrived, the renderer states the fact — `400 30m bars are stored for NIFTY50, but none fall inside
  the selected dates.` — and claims no cause: the suite asserts that sentence contains no "widen", no
  "provider" and no "fetch".
- `composed` on the returned object records whose sentence it is, so a reviewer can tell at a glance
  whether the renderer spoke or relayed.
- `nothing-in-window` **cannot** emit a fetch action. That is asserted directly.
- The window that *does* exist is printed under the headline (`stored 2019-04-01 → 2019-06-28`), so
  master can aim the pickers at it.
- `StockMind.jsx`'s own amber `barsNote` band is **unchanged**, so on the chart tab the route's
  sentence may appear both above the chart and as the empty state's headline. That duplication is
  deliberate: suppressing one of them is what HIGH 4 found wrong with the design, and the band is the
  only report of a note when candles *are* drawn.

### Item 3 — the engine-down diagnosis reaches every chart and every failure mode

`ensureBackendRunning` (`electron/ipc/marketIntel.cjs:123-131`) returns `error` (reason **and**
remedy), `diagnosis`, `detail` and `stderrTail` (lines 123-131); `getPath` (lines 186-190) returns it
verbatim. Only the StockMind chart tab read any of it, and only as a string.

- `StockMind.jsx` keeps the whole failed reply in `barsFail` and clears it when a fetch starts, so a
  stale failure cannot outlive the attempt that produced it.
- `PopoutPanel.jsx` keeps the same object in `fail`, including from its `catch` branch — a thrown
  error used to leave a chart that said "no bars stored".
- The overlay prints the sentence in red with `✕`, the remedy on its own line **when the headline does
  not already contain it**, the knocked URL as a dim detail, and the engine's last stderr lines in a
  collapsed `<details>`. The URL is never the headline (Section 106).
- Both failure shapes are handled: a gate object (`error` + `diagnosis`), and a route-level failure
  that carries `error` alone. With neither, the module says the reply carried no reason rather than
  inventing one.
- The four modes `scripts/verifyEngineDiagnosis.cjs` distinguishes — bound port, version mismatch,
  live-but-silent, unrecognised exit code — are asserted as a set to produce a reason and a remedy on
  the canvas, and none of them to be reported as an empty store.

### Files touched

| File | Change |
| --- | --- |
| `src/pages/StockMind/chartEmptyState.js` | **new**, pure, 138 lines |
| `src/pages/StockMind/PriceChart.jsx` | two new props, one `useMemo`, the overlay re-rendered from `emptyState()` |
| `src/pages/StockMind/StockMind.jsx` | `barsFail` state, one `coverage` memo, three props on each of two call sites |
| `src/pages/StockMind/PopoutPanel.jsx` | `meta`/`fail` state, three props on the call site, the duplicate error band narrowed to the bars-present case |
| `scripts/verifyChartEmptyState.mjs` | **new**, 80 assertions |
| `package.json` | `verify:empty-state` added; the chain **appended** after `verifyChartSessions.mjs` |
| `docs/research/FETCH_AND_STORE.md` | the deferral section appended; nothing else altered |

No protected file was touched. No dependency was added; nothing is range-pinned. No `console.log`, no
TODO/FIXME. No new `InfoTip` id, so `verifyGlossary.mjs` needed no new entry.

A new file was created under `src/pages/StockMind/` even though the brief restricted edits to the call
sites and `PriceChart.jsx`. The reason: a behavioural assertion was required, and `.jsx` cannot be
imported by a `.mjs` suite under plain node. Nothing else references the new module, so it cannot
conflict with another workflow's edits.

---

## 2. The reply fields — what exists versus what the design assumed

Read off `ai_backend/main.py` and `electron/ipc/marketIntel.cjs` at this HEAD.

**On `res.data`, success with bars (main.py:665-682):** `symbol`, `exchange`, `interval`, `bars`,
`count`, `stored`, `matched`, `requestedFrom`, `requestedTo`, `truncated`, `firstBar`, `lastBar`,
`storedFirstBar`, `storedLastBar`, `note` (truncation only), `meta`, `syncInfo`.

**On `res.data`, bars stored but none in the window (main.py:638-645) — the state item 2 is about:**
`symbol`, `exchange`, `interval`, `bars: []`, `count: 0`, `stored`, `storedFirstBar`, `note`, `meta`,
`syncInfo`. **`storedLastBar` is absent on this branch** — which is why `coverage.last` is nullable and
why the detail line reads `stored <first> → now` when it is missing.

**On `res.data`, nothing stored at all (main.py:600-604):** `bars: []`, `count: 0`, `stored: 0`,
`note`, `syncInfo`. No `meta`, no `storedFirstBar`.

**On a failed reply:** `{ ok: false, error, diagnosis: {reason, remedy}, detail, stderrTail }` from the
gate (marketIntel.cjs:125-131), or `{ ok: false, error }` alone from a route-level failure
(marketIntel.cjs:190).

| The design assumed | Reality |
| --- | --- |
| `emptyState({ bars, busy, failure, meta, syncInfo, intervalId, symbol, rangeId, contract })` | `meta` and `syncInfo` **do** arrive on `res.data` for two of the three branches, but **no call site passes them to `PriceChart`** and nothing in the renderer reads them. Not added: HIGH 5's point stands, and threading an unread prop is how the unreachable `nothing-upstream` state came to be specified in the first place |
| `coverage` superset of `stored`/`fetchedAt`/`source`/`truncated`/`ranges` | only `stored` was added. `truncated` exists on the reply; `fetchedAt`, `source` and `ranges` live on `meta`/`syncInfo` and belong to the deferred freshness work |
| `syncInfo.reason === 'no provider returned data'` and `providersTried`, driving `nothing-upstream` | **not verified to exist.** `syncInfo` is `store.sync`'s info dict (or `{fromStore: True}` on a disk read); the Python engine has never run here, so its contents could not be observed. `nothing-upstream` was therefore not built, and no sentence in this tranche depends on it |
| `describeFreshness(meta, syncInfo, receivedAt, now)` | not built. Its inputs are the two props deliberately not threaded |
| `contract` prop | not built; `describeRequest()` is deferred (see the design's deferral table) |
| `note` as a prop name | **collides** with `PriceChart`'s existing note-editor state. The prop is `replyNote` |

---

## 3. Suite counts, measured before and after

Measured by running each suite in this worktree, before any edit and again after all of them.

| Suite | Before | After |
| --- | --- | --- |
| `verifyChartTime.mjs` | 197 | **197** (the required constant, unmoved) |
| `verifyChartSessions.mjs` | 109 | 109 |
| `verifyEngineDiagnosis.cjs` | 34 | 34 |
| `verifyGlossary.mjs` | 48 | 48 |
| `verifyChartDrawings.mjs` | 232 | 232 |
| `verifyInvariants.cjs` | ALL PASS | ALL PASS |
| `verifyLoyaltyTripwire.cjs` | 12 / ALL PASS | 12 / ALL PASS |
| `auditRenderer.cjs` | pass | pass (79 files scope-checked, 365 IPC channels matched) |
| `verifyChartEmptyState.mjs` | — | **80 passed, 0 failed** (new) |
| `npm run verify` (full chain) | green | **green**, with the new suite appended, nothing reordered |

The full chain was re-run after the final edit, in a shell call separate from the edits, and every
suite in it reports 0 failed.

---

## 4. NOT VERIFIED

Read this section before believing anything above it.

- **Nothing was seen on a screen.** No chart was rendered, no overlay was looked at, no button was
  clicked. Every claim about what master will see is an inference from source plus the assertions in
  `verifyChartEmptyState.mjs`, which test the *decision*, never the pixels. Colour choices, wrapping
  of a long remedy inside the overlay, and whether the collapsed `<details>` fits a 260px workspace
  panel are all unverified.
- **`vite build` could not run.** `node_modules` is not installed in this worktree (`Test-Path
  node_modules` → `False`). The JSX was parsed by `scripts/auditRenderer.cjs`, which is what caught
  the `note` redeclaration, so the three `.jsx` files parse — but that is not a build, and no claim is
  made that the bundle compiles.
- **The Python engine has never completed a run on this machine.** So the `ohlcv` payload shapes in §2
  were read from `ai_backend/main.py`, not observed on the wire. In particular the absence of
  `storedLastBar` on the empty-window branch, and the contents of `syncInfo`, are source readings.
- **The `nothing-in-window` state has never been exercised end to end**, because exercising it needs a
  store with bars and a window that misses them, which needs the engine.
- **The failure overlay has never been seen with a real gate object.** The fixture in the suite is
  hand-written from the strings `ensureBackendRunning` composes.
- **No test covers the renderer's JSX.** There is no renderer test harness in this project; the
  overlay's markup is asserted only by source-level regex, which proves a binding exists and not that
  it renders.
- **The spec ledger (`RAMA_AGI_MASTER_SPEC.md` Section 28) was not updated.** A third workflow is
  active elsewhere in the repo and the spec is the most contended file; the ledger row for this
  tranche is the orchestrator's to write. This document is the record until it does.
- **Item 2's duplicate sentence on the chart tab is a judgement, not a verified improvement.** The
  route's note can appear twice — in StockMind's amber band and as the overlay headline. Suppressing
  either is a product decision that was not taken inside this loop.
