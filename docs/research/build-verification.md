# Fetch-and-store, narrowed tranche — build verification

**Branch** `chart/fetch-and-store` · **worktree** `.worktrees/fetch-store` · **base** `9669eea`
**Date** 2026-10-02. **Round 2** below (§0) records the review dispositions; §1-§4 are updated in place
to describe what is in the tree now, not what the first commit shipped.

The design in `docs/research/FETCH_AND_STORE.md` did not converge over three review rounds (5 HIGH,
4 HIGH, 6 HIGH) because it covered six subsystems at once. The orchestrator cut the scope to three
items; all six remaining HIGH findings fall in the deferred parts, which are listed with their gating
finding ids in the design document's appended **DEFERRED BY THE ORCHESTRATOR** section. Nothing in
the design was altered.

---

## 0. Round 2 — the review findings and what was done with each

`docs/research/build-review.json`, verdict `CHANGES_REQUESTED`: 1 HIGH, 2 MEDIUM, 2 NIT. All five
dispositions are **fixed**; none was argued down.

### HIGH 1 — a false *detail* replaced the false headline. FIXED.

The review is right, and it is the same class of defect as the one the tranche was built to end — moved
down one line. `chartEmptyState.js` rendered `stored ${first} → ${last || 'now'}`, and
`ai_backend/main.py`'s `matched == 0` branch (638-645) sends `storedFirstBar` and **no**
`storedLastBar`, while only the success branch (669-682) sends both. Since `matched == 0` is the only
branch `nothing-in-window` is reached through, `coverage.last` was null in **every real instance** of the
state, so the overlay always printed `stored 2019-04-01 → now` directly beneath a headline saying nothing
falls between 2024-01-01 and 2024-02-01. **If the store reached now, that window would have matched.**

Fix: a `describeStored()` helper renders `stored <first> → <last>` only when the end was carried, and
`stored from <first>` otherwise — no arrow, no right-hand side, nothing guessed. The assertion that
pinned the old wording is gone. In its place are eight assertions requiring that an absent end is not
rendered as `now`, not invented as a second date, not printed as `undefined`/`null`/a dangling arrow,
that the start which *was* carried is still stated, that a carried end still renders with the arrow, that
a blank string counts as absent, that a non-string start yields no detail line at all, and that with
neither end known there is no detail line to be wrong.

**Demonstrated, not assumed:** restoring the `→ now` expression turns **three** of those assertions red
(`93 passed, 3 failed`); the restored fix returns the suite to `96 passed, 0 failed`.

### HIGH/MEDIUM 2 — one failure reported twice on the chart tab. FIXED.

`PopoutPanel.jsx` gated its band on `error && bars.length > 0` and wrote down why; `StockMind.jsx`'s
`barsNote` band was left ungated while `barsNote` is set to `res.error` on the same failure. With the
engine down and no candles — **the state master is actually in** — he saw the amber band with the error,
its collapsed `engine output` and `engineDetail`, then the red overlay immediately below with the same
sentence, the same output and the same detail.

Fix: `{barsNote && bars.length > 0 && (…)}`, the same gate, with the reasoning in a comment beside it.
The band now covers only what the overlay cannot: a message arriving while the previous fetch's candles
are still drawn — which is also where the truncation note (`N bars match those dates; the newest M were
sent`) lands, so no note loses its surface. Two assertions require the gate in both files and name the
asymmetry as the thing being prevented.

This supersedes the first round's note under §4 that the duplication was deliberate. It was not a
judgement worth keeping: the overlay carries strictly more than the band in that state.

### MEDIUM 3 — no spec section and no ledger row. FIXED.

The resume protocol requires the decision in the spec, not only in `docs/research/`. Added:

- **`RAMA_AGI_MASTER_SPEC.md` Section 126** — the defect, then ten numbered decisions (the four states,
  the precedence order, the route's note used verbatim, the action that must be able to help, the
  unknown end left unsaid, why `meta`/`syncInfo` are not props, every failure mode to every chart, one
  report of one failure, the pop-out's absent dates asserted, and call sites discovered rather than
  counted), plus **126.3 Verified**, **126.4 Not verified** and **126.5 Next**.
- **Section 28 ledger row 146** — `3 items done, the rest deferred`, with the deferred queue and
  gap-kinds work named as the next concrete step together with the HIGH finding ids that gate each.
- The in-code citations of "Section 123.6" in `chartEmptyState.js`, `PriceChart.jsx`, `StockMind.jsx`,
  `PopoutPanel.jsx` and `verifyChartEmptyState.mjs` now read **Section 126**. 123.6 is the previous
  section's decisions list; its item 8 names this threading as the next tranche and records none of
  these decisions.

### NIT 4 — `nothing-in-window` would have no action in the pop-out. FIXED by assertion.

`clear-dates` renders only when `onDates` is supplied and `PopoutPanel` supplies `onFetch` alone, so
that state there would advise widening the dates with no control to widen them. It is unreachable today
because the pop-out calls `limitForDates(interval, null, null)` and sends no dates, so `/ohlcv` never
takes the `matched == 0` branch.

Of the two fixes the review offered, the assertion was taken rather than passing an `onDates`: giving the
pop-out date controls is a visible change to a surface nobody asked to change, and this loop does not
make product decisions. Five assertions now pin it — the pop-out call site sends no `fromDate`/`toDate`,
the request it makes carries no dates, **any** call site that does send dates must also send `onDates`,
and the button stays gated on the handler. Threading dates into the pop-out therefore fails the suite,
so whoever does it supplies the action first.

### NIT 5 — the threading assertions matched source text and a hardcoded count. FIXED.

The old block summed `<PriceChart` matches across two named files and required `=== 3`, so a fourth chart
in a third file would have left the suite green while reintroducing the one-of-three defect; and the
attribute patterns were whitespace-exact, so a line wrap would have failed a correct tree.

Fix: every `.jsx` under `src/pages/StockMind` is scanned, each `<PriceChart` element is sliced out, and
`coverage=`, `replyNote=` and `failure=` are required **on each site found** — matched by attribute name,
not by expression. The count assertions are now `>= 3` call sites across `>= 2` files, and the
`coverage={coverage}` count in `StockMind.jsx` is compared against that file's own number of call sites
rather than a literal `2`.

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
- The window that *does* exist is printed under the headline — `stored 2019-04-01 → 2019-06-28` when
  the reply carried both ends, and **`stored from 2019-04-01` when it carried only the start**, which
  is what the `matched == 0` branch actually sends (§0, HIGH 1). An unknown end is left unsaid rather
  than rendered as `now`.
- `StockMind.jsx`'s amber `barsNote` band is now gated on `bars.length > 0`, the same gate
  `PopoutPanel.jsx` uses, so one failure is reported once. The band's remaining job is the case the
  overlay cannot cover: a failure or a truncation note arriving while the previous fetch's candles are
  still drawn.

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
| `src/pages/StockMind/chartEmptyState.js` | **new**, pure; `describeStored()` added in round 2 |
| `src/pages/StockMind/PriceChart.jsx` | two new props, one `useMemo`, the overlay re-rendered from `emptyState()` |
| `src/pages/StockMind/StockMind.jsx` | `barsFail` state, one `coverage` memo, three props on each of two call sites, the `barsNote` band gated on drawn candles |
| `src/pages/StockMind/PopoutPanel.jsx` | `meta`/`fail` state, three props on the call site, the duplicate error band narrowed to the bars-present case |
| `scripts/verifyChartEmptyState.mjs` | **new**, 80 assertions in round 1, **96** after round 2 |
| `package.json` | `verify:empty-state` added; the chain **appended** after `verifyChartSessions.mjs` |
| `docs/research/FETCH_AND_STORE.md` | the deferral section appended; nothing else altered |
| `RAMA_AGI_MASTER_SPEC.md` | **Section 126** (ten decisions, verified, not verified, next) and **Section 28 ledger row 146**, both added in round 2 |

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
why the detail line reads `stored from <first>`, with no end at all, when it is missing. Rendering the
absence as `now` was the HIGH 1 defect: it claimed the store reached the present in the one state that
proves it does not.

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

| Suite | Before the tranche | After round 1 | After round 2 |
| --- | --- | --- | --- |
| `verifyChartTime.mjs` | 197 | 197 | **197** (the required constant, unmoved) |
| `verifyChartSessions.mjs` | 109 | 109 | 109 |
| `verifyChartDrawings.mjs` | 232 | 232 | 232 |
| `verifyEngineDiagnosis.cjs` | 34 | 34 | 34 |
| `verifyGlossary.mjs` | 48 | 48 | 48 |
| `verifyTimeframes.mjs` | 123 | 123 | 123 |
| `verifyInvariants.cjs` | 138 / ALL PASS | 138 / ALL PASS | 138 / ALL PASS |
| `verifyLoyaltyTripwire.cjs` | 12 / ALL PASS | 12 / ALL PASS | 12 / ALL PASS |
| `auditRenderer.cjs` | pass | pass | pass — 79 files, 37 store destructures, 139 bridge calls, 365 IPC channels |
| `verifyChartEmptyState.mjs` | — | 80 passed, 0 failed | **96 passed, 0 failed** |
| `npm run verify` (full chain, 26 suites) | green | green | **green**, 0 failures, the new suite appended and nothing reordered |

The full chain was re-run after the last edit, in a shell call separate from the edits, and every suite
in it reports 0 failed. The `verifyInvariants` run includes its unconditional self-test (13 planted
breaches, each turning its own row red) and its one `HELD BY HAND` row for I15, which is the pre-existing
Section 124 §9.1 question to master and not a product of this work.

**One assertion group was demonstrated rather than merely run:** restoring the `→ now` expression in
`describeStored()` produced `93 passed, 3 failed`, naming the three HIGH 1 assertions; restoring the fix
returned `96 passed, 0 failed`. The round-2 source-level assertions (the band gates, the pop-out's
absent dates, per-call-site props) were not planted-breach tested — they are regexes over source, and
their failure mode is the ordinary one.

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
- **The spec was edited on a contended file.** Section 126 and ledger row 146 are appended at the end
  of their respective blocks to minimise it, but a third workflow is active elsewhere in the repo and
  `RAMA_AGI_MASTER_SPEC.md` is the most contended file in the project. **If another branch also claims
  Section 126 or row 146, this is a merge conflict to resolve by renumbering, not a correctness
  problem** — the content is self-contained and the in-code citations are the only references to the
  number.
- **The band gate is reasoned, not seen.** Gating `barsNote` on `bars.length > 0` removes a duplicate
  report in the engine-down state. That a truncation note still reaches the screen follows from the
  route sending it only alongside bars (`main.py` 677-679), which is a source reading; it has not been
  observed, because the engine has not run.
- **The pop-out's `nothing-in-window` dead end is prevented by assertion, not by an action.** If the
  state ever does arise there, the overlay will advise widening the dates with no control to do it. The
  suite is what stops that shipping silently; it is not a fix for the state itself, and supplying the
  pop-out with date controls is a product decision master has not been asked.
