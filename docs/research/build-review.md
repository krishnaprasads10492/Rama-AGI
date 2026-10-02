# The empty chart stops saying "nothing stored" — review of the narrowed fetch-and-store tranche

Branch `chart/fetch-and-store`, one commit (`7bddcf6`) over the branch point `9669eea` on `dev`.
The tranche does the three things the orchestrator left in scope. The chart's empty-state sentence
moved out of JSX into a pure `emptyState()` in `src/pages/StockMind/chartEmptyState.js`, so the
thing that was wrong is now callable and asserted; `coverage` + `replyNote` + `failure` are threaded
to all three `<PriceChart` call sites as optional props defaulting to `null`; and the `nothing-in-window`
state replaces the false "No 30m bars stored for NIFTY50." headline with the route's own sentence and
swaps the fetch button for one that clears the dates. The deferred work (fetch queue, gap kinds, fill
affordance, lazy paging, `describeRequest`) is genuinely absent and recorded under
`## DEFERRED BY THE ORCHESTRATOR` in `docs/research/FETCH_AND_STORE.md`.

**Watch for:** the false headline is gone, but a false *detail* line took its place in the same state —
with the real route payload the overlay prints `stored 2019-04-01 → now` under a headline that says no
bars fall in a 2024 window, because `/ohlcv` omits `storedLastBar` on exactly the `matched == 0` branch
and the module renders the missing value as `'now'` (**confirmed**, reproduced by running `emptyState()`
against the route's literal reply shape). Second, the StockMind chart tab now reports an engine failure
twice — the pre-existing `barsNote` band and the new overlay, each with its own collapsed `engine output`
— which is the duplication `PopoutPanel` deliberately gated against (**confirmed**). Third, no spec
section or Section 28 ledger row records this tranche (**confirmed**).

**Verdict**: NEEDS_CHANGES

## High-level view

The split into a pure module is the right call and it is what makes the rest reviewable: the three
sentences are now decided by a function with no callbacks in and no JSX out, the renderer only picks
colours and binds an `action.id` to a handler it already had, and `scripts/verifyChartEmptyState.mjs`
(80 assertions, green) exercises kind, headline, remedy, detail, hint, tail and action per state rather
than scraping rendered text. Precedence is `bars > 0` → nothing, then `busy`, then `failure`, then
`stored > 0`, then nothing-yet, and that ordering is the substance of items 2 and 3 — a failed reply no
longer lets a stale `coverage` describe a moment that has passed.

Item 2 eliminates the false headline but relocates a smaller falsehood into the detail line directly
beneath it. The discriminator is `stored > 0` from `res.data.stored`, which `/ohlcv` sends on all three
of its branches, so the split cannot silently degrade to "nothing stored" when bars are on disk. What
is wrong is the adjacent `detail`: the same route branch sends `storedFirstBar` and no `storedLastBar`,
and `stored ${first} → ${last || 'now'}` turns that absence into a claim that the store runs to the
present — contradicting the headline above it.

The reply fields the props read all exist. `stored`, `storedFirstBar`, `storedLastBar` and `note` are on
`/ohlcv`'s payload; `error`, `diagnosis.{reason,remedy}`, `detail` and `stderrTail` are on the gate object
`electron/ipc/marketIntel.cjs` returns. `meta` and `syncInfo` were correctly not turned into props, and
the suite asserts they were not. Every new prop defaults to `null` and the three existing call sites keep
working without them (I11), with `replyNote` named to avoid shadowing the note editor's own `note` state.

Failure reporting reaches all three charts for all modes, including the route-level shape that carries
`error` alone and the thrown-exception path in the pop-out, and the remedy is printed separately only when
the composed headline does not already contain it. The cost is a duplicate report on the chart tab: the
pop-out gated its red band on `bars.length > 0` so the band only covers the case the overlay cannot (a
failed refresh over still-drawn candles), and StockMind's equivalent band was left ungated.

Process-wise the tranche is documented in `docs/research/` but not in the spec. The new code cites
"Section 123.6" throughout, which is the *previous* section's decisions list — its item 8 does name the
coverage threading as the next tranche, but nothing in `RAMA_AGI_MASTER_SPEC.md` records
`chartEmptyState.js`, the three-state machine, or `verify:empty-state`, and Section 28 has no row for it.

Suites re-run here: `verifyChartEmptyState.mjs` 80/0, `verifyChartTime.mjs` **197/0** (file untouched by
this diff), `verifyChartDrawings.mjs` 24/0, `verifyChartSessions.mjs` 109/0, `verifyEngineDiagnosis.cjs`
34/0, `auditRenderer.cjs` clean, `verifyInvariants.cjs` and `verifyLoyaltyTripwire.cjs` ALL PASS, and the
remaining 18 scripts in the `verify` chain all exit 0. No `.cjs` was touched. The four touched renderer
files parse and transform cleanly through the main workspace's esbuild. `node_modules` is absent in the
worktree, so `npx vite build` genuinely cannot be run and is not held against the work. No dependency
added, nothing range-pinned, no `console.log`, no TODO/FIXME, no protected file touched.

<details>
<summary>Issues (5)</summary>

1. **False coverage detail in `nothing-in-window`** — `chartEmptyState.js` renders `stored ${first} → ${last || 'now'}`, and `/ohlcv`'s `matched == 0` branch never sends `storedLastBar`, so the overlay always claims the store reaches the present in exactly the state that exists to stop untrue sentences. Print `stored from ${first}` when `last` is null, and change the suite assertion that currently locks the `→ now` wording in.
2. **The engine failure is reported twice on the chart tab** — `StockMind.jsx`'s `barsNote` band and the new overlay both print the failure sentence and both carry a collapsed `engine output`. Gate the band on `bars.length > 0` as `PopoutPanel.jsx` does, or drop its tail/detail now the overlay carries them.
3. **No spec or ledger record** — nothing in `RAMA_AGI_MASTER_SPEC.md` documents the three-state empty-state machine or `verify:empty-state`, and Section 28 has no row for this tranche; the comments cite 123.6, which predates it. Add the decision subsection and the ledger row with the next concrete step.
4. **`nothing-in-window` has no action in the pop-out** — the `clear-dates` button requires `onDates`, which `PopoutPanel` does not pass, so that state would render a headline advising the dates be widened and no way to do it. Unreachable today because the pop-out sends no dates; pass `onDates` or assert the state cannot arise there.
5. **Threading assertions match source text, not behaviour** — the call-site checks are whitespace-exact regexes over two named files plus a hard count of three `<PriceChart`, so a reformat fails them and a fourth chart added in a new file passes them. Match on the attribute name alone, and derive the file list rather than hardcoding it.

</details>

<details>
<summary>Details</summary>

### Does item 2 eliminate the false statement, or relocate it?

Both. The headline is fixed and the detail beneath it is not. Running the module against the literal
`matched == 0` reply from `ai_backend/main.py` — `stored: 400`, `storedFirstBar: "2019-04-01"`, no
`storedLastBar`, the note present — mapped through `StockMind.jsx`'s own `coverage` memo:

```
kind:     "nothing-in-window"
headline: "400 30m bars are stored, but none fall between 2024-01-01 and 2024-02-01.
           Widen the dates, or fetch more history."     ← true, and the route's own words
detail:   "stored 2019-04-01 → now"                     ← false, and contradicts the headline
action:   { id: "clear-dates", label: "✕ clear dates" }
```

If the store really ran to `now`, a 2024 window would have matched. The two sentences cannot both be
true, and the one master is told to "aim at" is the wrong one. This is not an edge case: the route omits
`storedLastBar` on that branch and only that branch, so `last` is null *whenever* this state is reached
through the real engine. The comment in `StockMind.jsx` notes the omission and treats it as benign
("`storedLastBar` is deliberately allowed to be null, because the route omits it in precisely that second
case"), and the suite pins the consequence as intended:

```js
check('a missing storedLastBar reads as "now" rather than as undefined',
  s.detail === 'stored 2019-04-01 → now', s.detail);
```

Reading `'now'` instead of `undefined` is the right instinct applied to the wrong half of the string. The
honest rendering of a known start and an unknown end is `stored from 2019-04-01`.

Everything else about the discrimination holds. `stored` is present on all three `/ohlcv` return paths, so
there is no input where bars exist on disk and the module falls back to `nothing-yet`: the empty-store
branch sends `"stored": 0` explicitly, and `Number.isFinite(coverage?.stored) ? coverage.stored : 0` only
degrades to `nothing-yet` when the field is absent or non-numeric, which the route does not do. The
composed fallback for a missing note states the count and the window without naming a cause, and
`composed` flags which sentence is whose.

### Is the note ever suppressed when nothing truer is available?

Once, defensibly. On the empty-store branch the route sends "Nothing stored for this symbol. Call again
with `sync=true` to fetch it, which reaches back as far as the provider chain allows." and the module
discards it for the Section 107 headline. The replacement names the symbol, the interval and the range,
offers the fetch as a button rather than as an instruction, and adds `describeLimit(interval)` as the
provider-reach hint — so the note's information is on screen in a followable form rather than dropped.
The truncation note (`"N bars match those dates; the newest M were sent"`) arrives with `bars > 0`, where
`emptyState()` correctly returns `null`; it is surfaced by StockMind's `barsNote` band as before.

### Is the offered action always one that can help?

For `nothing-in-window`, yes, and it is bound to the existing `onDates` handler via `onDates('', '')`,
which `setDates` accepts and which re-triggers the load effect. One mismatch is worth naming: the headline
is the route's verbatim sentence ending "Widen the dates, **or fetch more history**", while the only button
offered clears the dates. The removal of the fetch button is what the tranche asked for, so this is a
wording collision rather than a defect — but master is being advised, in Rāma's own text, to do a thing
the screen no longer offers.

For `failed` the action is `↻ Try again`. A retry cannot by itself install `fastapi` or free port 8001, so
on its own it would be the same class of unfollowable action the tranche set out to remove; what rescues it
is that the remedy is on screen beside it, and a retry is precisely the follow-up to the remedy. The pop-out
gap is the real hole: `clear-dates` renders only when `onDates` is supplied, and `PopoutPanel` supplies
`onFetch` and not `onDates`. That state cannot currently arise there, because the pop-out calls
`limitForDates(interval, null, null)` with no dates so the route never takes the `matched == 0` branch, but
the dead end is one prop away.

### Threading, and what the threading assertions actually assert

```
         StockMind.jsx ──── coverage (one useMemo) ─┬─→ <PriceChart sm-chart>
            barsMeta ───────── replyNote ───────────┤
            barsFail ───────── failure ─────────────┴─→ <PriceChart sm-ws-chart>

      PopoutPanel.jsx ──── meta → coverage/replyNote ──→ <PriceChart popout-chart>
                            fail → failure
```

The duplicated inline `coverage` object on the chart tab is gone, both StockMind charts now bound their
pickers from the same memo, and the pop-out keeps `diagnosis`, `detail` and `stderrTail` instead of
reducing a failed reply to a string — including in its `catch`, so a thrown error is a named failure
rather than a silently empty chart.

The per-state assertions in sections 1–6 of the suite are behavioural: they call the function and check
`kind`, the headline's identity with the route's note, `action.id`, `remedy` being emitted exactly once,
the tail filtering non-strings, and that all four `verifyEngineDiagnosis` modes reach the canvas with both
a reason and a remedy. Section 7 is different in kind — regex over the JSX source, which the comments
acknowledge is the only way to see a missing attribute. It is the weak half: `/replyNote=\{barsMeta\?\.note \|\| null\}/`
with an exact-count of 2 breaks on a line wrap, and `((stock.match(/<PriceChart/g) || []).length + (popout...)) === 3`
pins a total across two hardcoded files, so a fourth chart introduced in a third file leaves the suite green
while reintroducing exactly the defect this tranche fixed.

### The failure is reported twice on the chart tab

`PopoutPanel.jsx` changed its red band to `error && bars.length > 0` with the reasoning written down: the
overlay now carries the reason, the remedy and the engine's last lines, so the band would repeat its first
sentence with less in it, and it stays only for a failed refresh over still-drawn candles. `StockMind.jsx`
got the other half of the change — `barsFail` threaded to both charts — but its `barsNote` band at line 774
was left ungated, and `barsNote` is set to `res.error` on the same failure. With the engine down and no
candles, master now sees the amber band with the error, its collapsed `engine output` and `engineDetail`,
and immediately below it the red overlay with the same sentence, the same collapsed `engine output` and the
same detail. Master's engine has never completed a run, so this is the state he actually lands in.

</details>

<details>
<summary>Files changed</summary>

- `src/pages/StockMind/chartEmptyState.js` — new pure module deciding the four empty-chart states
- `src/pages/StockMind/PriceChart.jsx` — `replyNote`/`failure` props, overlay renders from `emptyState()`
- `src/pages/StockMind/StockMind.jsx` — one shared `coverage` memo, `barsFail` state, both charts threaded
- `src/pages/StockMind/PopoutPanel.jsx` — keeps `meta`/`fail` from the reply, band gated on drawn candles
- `scripts/verifyChartEmptyState.mjs` — new suite, 80 assertions
- `package.json` — `verify:empty-state` added and appended to the `verify` chain
- `docs/research/FETCH_AND_STORE.md` — `## DEFERRED BY THE ORCHESTRATOR` prepended to the unbuilt design
- `docs/research/build-verification.md`, `design-review.md`, `design-review.json` — prior-round records

Full diff: `git diff 9669eea` in `.worktrees/fetch-store`.

</details>
