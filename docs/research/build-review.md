# The empty chart stops saying "nothing stored" — review of the narrowed fetch-and-store tranche

Three things were in scope after the orchestrator narrowed the design: `coverage` plus the whole failed
reply plus the route's own sentence threaded to all three `<PriceChart` call sites as optional props; the
false "No 30m bars stored for NIFTY50" headline eliminated for the case where bars are stored but none
fall in master's window; and the engine-down diagnosis reaching every chart for every failure mode with
both reason and remedy. All three are delivered. The sentence is no longer composed inside JSX: a pure
`src/pages/StockMind/chartEmptyState.js` returns one of four states (`fetching` · `failed` ·
`nothing-in-window` · `nothing-yet`) with a headline, a detail, an engine tail and an action *id*, which
is what makes it assertable — `scripts/verifyChartEmptyState.mjs` runs 96 assertions against it, and I
re-ran the full `npm run verify` chain in the worktree rather than trusting the recorded numbers.

**Watch for:** the composed fallback headline for `nothing-in-window` ("…but none fall inside the
selected dates") is the one sentence in the module that can still be false, and it is reachable only if
the renderer discards bars the reply did carry (confirmed by reading the branch; the input that reaches
it is not producible from `/ohlcv` today). The route's `stored == 0` note is dropped from both surfaces
rather than shown (confirmed). The retry button offered on a capability denial cannot help (confirmed).
None of the three is a false statement on a path master can reach.

**Verdict**: APPROVED

## High-level view

The decision to move the sentence out of the render is the substance of the tranche. Three releases of
wrong text survived because the string was assembled between JSX braces where nothing could call it;
`emptyState()` takes facts in and returns a renderable object out, with no callbacks and no JSX, so each
of the four sentences is now pinned by assertions that fail when the wording regresses.

The precedence order is where the truth claim actually lives: candles on screen → say nothing, then
`busy`, then `failure`, then `stored > 0`, then nothing-yet. A failed reply outranks `coverage` because
`coverage` after a failure is whatever the last success left behind — a description of a moment that has
passed. The distinguishing fact between the two empty states is `coverage.stored`, straight off
`res.data.stored`, which the route sets on every branch.

For the state the tranche exists for, the headline is the route's own note verbatim and the action is
`clear dates`, not a fetch. Both halves matter: fetching cannot move bars into a window the provider does
not serve, and clearing the dates genuinely refetches, because `fromDate`/`toDate` are in the effect that
calls `loadBars`. The composed fallback that fires when no note arrived is honest about the count but
asserts that dates are selected, which it has no input to know.

Every prop the renderer is given exists on a real payload: `note`, `stored`, `storedFirstBar` and
`storedLastBar` on the `/ohlcv` reply, and `error` / `diagnosis` / `detail` / `stderrTail` on the gate
object the bridge returns verbatim. The design's assumed `meta` and `syncInfo` were not turned into
props, so nothing invented came back.

Both pages gate their pre-existing message band on drawn candles, so one failure is reported once. The
band still covers the case the overlay cannot: a refresh or a truncation note arriving while the previous
fetch's candles are on screen.

Nothing was seen on a screen. `node_modules` is absent from the worktree, so `npx vite build` genuinely
cannot run there and its absence is not held against the work; the renderer audit, which is this
project's own `.jsx` scope check, passes. The `matched == 0` reply is reproduced from the route's source,
not observed, because the Python engine has never completed a run on this machine.

<details>
<summary>Issues (3)</summary>

1. **Composed `nothing-in-window` fallback claims a window** — when no `note` arrives, the headline says
   "…but none fall inside the selected dates", which is false on the only input that can reach it (bars
   returned, all discarded by `toChartTime`/finite filters, possibly with no dates selected at all). Feed
   `emptyState` the raw reply bar count alongside `candles.length` and give the discard its own sentence,
   or drop the clause about dates from the fallback.
2. **The `stored == 0` note is suppressed on both surfaces** — the route's "Nothing stored for this
   symbol. Call again with sync=true…" is replaced by the composed Section 107 headline and hidden from
   the band; for `1d`, `describeLimit` returns null so no hint carries the provider-reach clause either.
   Either print the note as the hint when `stored == 0`, or state in Section 126 that this note is
   deliberately superseded rather than that notes are never suppressed.
3. **Retry is offered on a capability denial** — `denyUnless` returns `{ok:false, error:"Access
   denied…"}` with no diagnosis, which becomes a `failed` state with `↻ Try again`; retrying can never
   succeed, and the overlay's fetch button is the one chart control not gated on `canView`. Gate
   `onFetch` on the capability at the call site, or suppress the action for a denial.

</details>

<details>
<summary>Details</summary>

### Does item 2 eliminate the false statement, or relocate it?

It eliminates it on the path master reaches. The branch that decides between the two empty states is
`Number.isFinite(coverage?.stored) ? coverage.stored : 0` — not a note, not a date comparison — and
`coverage.stored` is `res.data.stored`, which `ai_backend/main.py` sets on all three of its return
shapes: `0` when `store.load` yields nothing, `len(df)` on the `matched == 0` branch, `len(df)` on
success. So "nothing stored" and "stored but not in this window" are separated by the store's own count
rather than by an inference, and the headline for the second is `res.data.note` character for character,
which names both counts and both dates.

The one sentence that can still be false is the fallback used when `stored > 0` and no note arrived:

```js
headline: typeof note === 'string' && note.trim()
  ? note.trim()
  : `${stored} ${label} bars are stored for ${who}, but none fall inside the selected dates.`,
```

Tracing which replies can reach it: the `matched == 0` branch always sends a non-empty note, and the
truncation branch sends one too, both with `stored > 0`. The success branch sends `note: null`, but it
also sends bars — `tail = window.tail(max(10, min(limit, 20000)))` cannot be empty when `matched > 0`.
So the fallback fires only when the reply carried bars and `candles` came out empty anyway, which happens
when every bar fails `toChartTime` or the `finite` check on open/high/low/close. In that state the
sentence is wrong twice over: the bars *did* fall inside the window, and if master had cleared the dates
(`pickRange(null)` sets both to `''`) there is no window to be wrong about. `emptyState` is handed
`bars: candles.length` and so cannot tell a reply with no bars from a reply whose bars it threw away.

I could not produce that input from the route. `pd.to_datetime(..., errors='coerce')` plus `dropna`
removes unparseable stamps before serialisation, and the two stamp formats the route emits
(`%Y-%m-%d %H:%M:%S` and `str(date)`) are both accepted by `toChartTime`; a non-finite price would make
the engine emit bare `NaN`, which fails `JSON.parse` in the bridge and arrives as a route-level failure
rather than as a dropped candle. That is why this is a NIT rather than a blocker — but it is a latent
trap, and the suite's "with no note on the reply" fixture tests an input the route cannot currently
produce, which makes the fallback look exercised when it is only reachable through a defect elsewhere.

One consequence of the same `bars`-versus-`candles` split: StockMind gates its band on `bars.length > 0`
while the overlay is gated on `candles.length === 0`, so in the discard case both appear at once and the
failure is reported twice again. Same cause, same fix.

### The note the renderer talks over

When `store.load` returns nothing the route sends `"Nothing stored for this symbol. Call again with
sync=true to fetch it, which reaches back as far as the provider chain allows."` with `stored: 0`. That
lands in `nothing-yet`, whose headline is composed — `No 30m bars stored for NIFTY50 over 1Y.` — and the
note is not rendered anywhere: the band is now gated on drawn candles, and `nothing-yet` has no field
that carries it. Nothing false is shown — the composed sentence also names the interval and the range the
route's note omits, and the fetch button replaces the `sync=true` advice. What is lost is the
provider-reach clause, and `hint` only substitutes for it on capped intervals — for `1d`,
`describeLimit` returns null, so a daily chart with an empty store shows no equivalent. Section 126's
claim that "the note is never suppressed when the renderer has nothing truer to say" is stronger than
what the code does on this branch.

### Actions that can help, and one that cannot

`✗ clear dates` is wired to `onDates('', '')`, and the window really does widen: `setDates` writes both
dates and the effect on `[sym, exchange, barInterval, fromDate, toDate]` refires `loadBars`. The button
is gated on `onDates`, so the pop-out — `onFetch` and no `onDates` — renders no action rather than an
inert one, and the suite pins the pop-out to sending no dates so threading them later fails first.

The gap is on the failure side. `denyUnless` returns `{ok: false, error: 'Access denied: "stockmind.view"
is not available to …'}` with no diagnosis, which `failureState` renders as a named failure with
`action: {id: 'fetch', label: '↻ Try again'}`. Retrying a denial cannot change its outcome. The same
user reaches it by clicking the overlay's fetch button, which is the one chart control not disabled on
`canView` (the two toolbar buttons are). The dead fetch button predates this tranche; the retry loop on
top of it is new.

### Threading, and what the source-level assertions buy

`PopoutPanel.jsx:173`, `StockMind.jsx:873` and `StockMind.jsx:964` are the only `<PriceChart` elements in
`src`, and all three carry all three props, each defaulting to `null` in the signature — I11 holds. The
chart tab's inline `{first, last}` object was replaced by the shared `coverage` memo, so two charts drawn
from one reply can no longer bound their pickers differently. `replyNote` rather than `note` avoids
shadowing the inline note editor's state, and the suite asserts the shorter name cannot come back.

The threading assertions are source-text matches, which is unavoidable — no behavioural test of a pure
function can see a missing JSX attribute — but they are now written so that the thing they are meant to
catch actually fails them: call sites are discovered by scanning every `.jsx` under
`src/pages/StockMind`, each discovered site is required to carry all three attributes, and the patterns
match attribute names rather than whole expressions. A fourth chart in a new file reintroducing the
one-of-three defect goes red. That closes NIT 5 from the prior pass.

### What the suites assert

Sections 1–6 of `verifyChartEmptyState.mjs` call `emptyState()` and assert behaviour, not string
presence: precedence (`busy` outranks a stale failure, a failure outranks a full store), the action id
per state, the absence of `/No .* bars stored for/` whenever `stored > 0`, `composed` flipping with the
note's presence, the remedy reaching the screen exactly once across both failure shapes, all four engine
failure modes producing a reason and a remedy, and junk input returning a renderable object with every
key present. The detail-line assertions are the sharpest: they require that an absent `storedLastBar` is
not rendered as `now`, not invented as a date, and not left as a dangling arrow — the exact defect the
prior pass found, with the false `→ now` expression demonstrably red.

Re-run in the worktree: `verifyChartEmptyState` 96/0, `verifyChartTime` 197/0 (unmoved),
`verifyChartDrawings` 232/0, `verifyChartSessions` 109/0, `auditRenderer` clean, `verifyInvariants` ALL
PASS, `verifyLoyaltyTripwire` 12/0 byte-for-byte, and the whole `npm run verify` chain exits 0. No
`console.log` and no TODO/FIXME in any shipped file touched (the new suite prints like every other suite
in `scripts/`); no dependency added and nothing range-pinned; no protected file touched, which the
tripwire confirms rather than my reading it.

Not tested, and not testable here: anything on a screen — colour, contrast of `var(--amber)` on the
overlay, the collapsed `engine output` affordance, and whether the two-line headline plus detail plus
hint plus `<details>` fits the 260px workspace panel before `overflow: auto` starts scrolling. The
`matched == 0` reply is a fixture copied from the route's source, so a wording change in `main.py` would
not be caught — correctly, since nothing asserts on its words, only on its being used verbatim.

### Prior-pass findings

All five findings from the previous review are closed on the branch: the `→ now` detail line (HIGH 1),
the ungated StockMind band that doubled the failure report (MEDIUM 2), the missing Section 126 and
Section 28 ledger row 146 (MEDIUM 3), the pop-out's actionless `nothing-in-window` (NIT 4), and the
count-based threading assertions (NIT 5). `## DEFERRED BY THE ORCHESTRATOR` is present at the end of
`docs/research/FETCH_AND_STORE.md`, and the queue, gap kinds, the fill affordance, lazy paging and
`describeRequest` are correctly absent from the code.

</details>

<details>
<summary>Files</summary>

- `src/pages/StockMind/chartEmptyState.js` — new pure four-state empty-chart module.
- `src/pages/StockMind/PriceChart.jsx` — `replyNote` and `failure` props; overlay renders the decided
  state instead of composing one.
- `src/pages/StockMind/StockMind.jsx` — whole failed reply kept in `barsFail`, one shared `coverage`
  memo, both charts threaded, message band gated on drawn candles.
- `src/pages/StockMind/PopoutPanel.jsx` — keeps the reply's meta and the diagnosis; same band gating.
- `scripts/verifyChartEmptyState.mjs` — new suite, 96 assertions.
- `package.json` — `verify:empty-state` script, appended to the `verify` chain.
- `RAMA_AGI_MASTER_SPEC.md` — Section 126 and Section 28 ledger row 146.
- `docs/research/FETCH_AND_STORE.md`, `design-review.*`, `build-verification.md` — design record and the
  deferred list.

Full diff: `git diff 9669eea` on `chart/fetch-and-store`.

</details>
