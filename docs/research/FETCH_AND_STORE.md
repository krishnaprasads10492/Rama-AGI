# FETCH AND STORE — the diagnosis, and the TradingView contract we are missing

**The complaint, verbatim.** Master (Krishna Prasad): *"chart functionality of fetch and store is not
proper and really a good experience. Understand trading view implementation of all the chart related
functionalities and research them thoroughly and implement."*

Read as the whole loop — pick an instrument, pick an interval and a window, get the bars on screen,
keep them — not as one button.

**What this document is.** Phase 1 is an honest diagnosis of the fetch-and-store path as it exists on
disk, read end to end, with file and line for every claim. Phase 2 compares it against TradingView's
*documented datafeed contract*. Phases 3+ (the design and the plan) are not in this document.

**Method and date.** 2026-10-02. Every Phase 1 fact was read off source in
`c:\CodeBase\Velvet_UI\Velvet\Rama_AGI\.worktrees\fetch-store`. Phase 2 draws on the research already
on disk (`docs/research/CHART_LANDSCAPE.md`, `landscape-cluster-A.md`) **plus three TradingView
charting-library pages retrieved live this session** — outbound HTTPS worked for
`tradingview.com/charting-library-docs`, which the earlier passes could not reach for this material.
What could not be checked is in **NOT VERIFIED** at the end, and that section is load-bearing: an
admitted gap beats a plausible claim.

**The single most important environmental fact.** The Python engine has never completed a run on
master's machine. Every price-history fetch goes through it. So two causes were candidates, and they
are distinguished in Phase 1 rather than assumed: (a) the renderer flow is genuinely clumsy, (b) it
fails silently because the engine is not there. **Both are true, and (b) is partly already handled —
see Finding One.**

---

# PHASE 1 — WHAT ACTUALLY HAPPENS

## 1.0 The path, once, so the line references below have a shape to hang on

| Hop | Where |
| --- | --- |
| 1 | `src/pages/StockMind/StockMind.jsx:214` — `loadBars(doSync)`; the one fetch entry point for the page |
| 2 | `StockMind.jsx:222` — `limitForDates(barInterval, fromDate, toDate)` computes a payload ceiling |
| 3 | `StockMind.jsx:223` — `window.rama.marketIntel.ohlcv({ … interval, limit, sync, fromDate, toDate })` |
| 4 | `electron/ipc/marketIntel.cjs:202` — `ohlcv()` validates the date shape and builds the query string |
| 5 | `marketIntel.cjs:186` — `getPath()` → `ensureBackendRunning()` (`:40`) → `net.getJson` |
| 6 | `electron/lib/http.cjs:190` — `getJson`, the one main-process client (invariant I9) |
| 7 | `ai_backend/main.py:578` — `GET /ohlcv/{symbol}` |
| 8 | `ai_backend/engine/store.py:301` — `store.sync()` when `sync=true`, else `store.load()` (`main.py:598`) |
| 9 | `ai_backend/engine/providers.py:564` — `fetch_history()` walks the provider chain |
| 10 | `store.py:144` — `merge()` unions the answer into the CSV and rewrites the `.meta.json` |

**The three `PriceChart` call sites**, because almost every renderer defect below is "one of three":

| # | Call site | `coverage`? | Can change interval/window? | What `onFetch` does |
| --- | --- | --- | --- | --- |
| 1 | `StockMind.jsx:922` — the CHART tab | **yes** (`:933`) | yes | `loadBars(true)` — a real sync (`:937`) |
| 2 | `StockMind.jsx:837` — the WORKSPACE board | **no** | yes | `loadBars(true)` — a real sync (`:842`) |
| 3 | `PopoutPanel.jsx:148` — a popped-out window | **no** | **no** | `loadBars` with **no `sync`** (`:149`, `:100`) |

## 1.1 OBSERVED FACTS

### A first fetch — nothing stored yet, engine up

1. **The page fetches from disk first, always, and never from the network on its own.** The mount
   effect (`StockMind.jsx:355`) and the filter effect (`:370`, deps `[sym, exchange, barInterval,
   fromDate, toDate]` at `:372`) both call `loadBars(false)` — `sync: false`. A network fetch happens
   only when master presses a button. That is a deliberate and correct choice (`main.py:588` says so),
   and it means **the first view of any new instrument is always empty**.

2. **With nothing stored, the engine returns an advisory, not an error.** `main.py:600` → the payload
   carries `note: "Nothing stored for this symbol. Call again with sync=true to fetch it, which
   reaches back as far as the provider chain allows."` (`:602`).

3. **Master sees that state written twice, in two wordings, in two places.** The canvas overlay
   (`PriceChart.jsx:2093`, over the always-mounted canvas — the Section 107 fix) says *"No 30m bars
   stored for NIFTY50"* plus a **⇩ Fetch & store them** button plus `describeLimit(interval)`. The
   controls card (`StockMind.jsx:746`) separately prints the engine's own sentence in amber. Neither
   knows about the other.

4. **Pressing ⇩ reaches the provider, and for intraday the requested window is ignored by
   construction.** `loadBars(true)` → `sync=true` → `main.py:595` `store.sync(sym, exchange,
   interval)` — **no window argument exists in that signature** (`store.py:301`). `store.sync`
   computes `want_years = 30 if nothing stored else 1` (`store.py:327`) and calls
   `providers.fetch_history` (`:328`). For any intraday interval `fetch_history` only tries Yahoo
   (`providers.py:574`) and Yahoo is asked for a **fixed constant range** —
   `INTRADAY_RANGE` (`providers.py:341`) interpolated at `:374` (`1m`/`2m` → `5d`; `5m`/`15m`/`30m` →
   `1mo`; `60m` → `2y`). **`want_years` is discarded for every intraday interval.**

5. **What master sees after a successful first fetch.** Candles, and one line of provenance:
   `"{stored} stored from {storedFirstBar}"` (`StockMind.jsx:893-895`). He is **not** told which
   provider answered (`syncInfo.source`), how many bars were new (`meta.barsAdded`), or that this was
   a network fetch rather than a disk read. All three are on the payload he just received and are
   never read.

### A repeat fetch of the same window

6. **The second press usually reaches no network at all, and says nothing about it.**
   `store.sync:322` is `need = force or stored is None or is_stale(...)`. **The route never passes
   `force`** (`main.py:595`), so `force` is always `False`. `is_stale` for intraday
   (`store.py:267-285`) returns `False` while the newest bar is younger than two bar widths, and then
   returns `False` again while `lastFetchedAt` is inside a `max(5, span)`-minute cooldown. For `30m`
   that is a 60-minute window in which "Fetch from provider" is a no-op.

7. **The no-op is indistinguishable from a successful fetch.** `store.sync` sets
   `info["reason"] = "store is current"` (`store.py:324`); the route returns it as `syncInfo`
   (`main.py:681`). The renderer assigns the whole payload to `barsMeta` (`StockMind.jsx:240`) and
   then reads exactly three fields from it anywhere in the tree — `stored`, `storedFirstBar`,
   `storedLastBar` (`:893`, `:933`). **`syncInfo`, `matched`, `truncated`, `requestedFrom`,
   `requestedTo` and `meta` are delivered and discarded.** Master sees the spinner, then no change and
   no sentence. He cannot tell a cooldown from a provider with nothing new from a provider that was
   never asked.

### An overlapping window, and any historical window

8. **`fromDate`/`toDate` are a post-hoc filter over what is already stored — they never reach the
   provider.** The renderer sends them (`StockMind.jsx:226`), the bridge validates their shape and
   appends them (`marketIntel.cjs:207-214`), and `main.py:618-636` applies them with
   `window[window["date"] >= start]` / `<= end` **after** the store has been loaded or synced. The
   fetch in step 4 never saw them.

9. **So asking for a window Rāma does not hold produces advice that cannot be followed.** With bars
   stored but none in range, `main.py:638-645` returns
   `"{stored} {interval} bars are stored, but none fall between {from} and {to}. Widen the dates, or
   fetch more history."` Master then presses **⇩ Fetch & store them**, which fetches the *provider's
   fixed window* again (step 4) and changes nothing. **The message names a remedy the system does not
   implement.** This is the mechanical heart of "fetch and store is not proper": the window is a
   display filter wearing a request's clothes.

10. **There is no incremental fetch, because there is nothing to be incremental against.** `merge`
    (`store.py:144`) is a correct union — de-duplicated on the date key, newer corrects older, and it
    refuses to shrink (`:191-194`). But the *fetch* is unconditional and fixed-width, so a second sync
    re-downloads the same window and merges it over itself. Nothing computes "what is missing".

11. **The store therefore develops silent holes on every intraday interval, and nothing can see
    them.** Fetch `30m` today and the store covers sessions D−21…D. Open the app two months later and
    the provider serves D+42−21…D+42; the union is two blocks with ~21 sessions missing between them.
    The provenance record (`store.py:207-216`) holds `bars`, `firstBar`, `lastBar`, `yearsCovered` —
    **a count and a span, never a set of ranges.** `inventory()` (`:346`) returns those same dicts.
    The route reports `stored` and `storedFirst/LastBar`; the renderer reduces that further to
    `coverage = {first, last}` (`StockMind.jsx:933`). **A chart that draws straight across that hole
    is asserting continuity it does not have**, and no layer in the stack has the information to say
    otherwise. Daily self-heals (the business-day staleness branch plus a `years=1` top-up covers any
    gap under a year); **no intraday interval does.**

### A window beyond the provider cap

12. **Before the request, the limit is visible — and this part is good.** `allRangesFor`
    (`timeframes.js:112-134`) flags `beyondCap`, and the preset button draws a ⚠ with an explanatory
    title (`PriceChart.jsx:1800-1803`). That is the same "make the loading contract visible" instinct
    MT5 and IBKR publish.

13. **After the request, the shortfall sentence is often unreachable.** `shortfallNote` is computed
    only when `rangeId` is non-null (`PriceChart.jsx:1573-1575`) and rendered at `:2036` and `:2281`.
    But `barRange` starts `null` (`StockMind.jsx:197`), a new instrument resets it to `null`
    (`:383`), and clicking the already-lit preset sets it to `null` on purpose (`:259-266`). **On
    the default view — 30m, no filter, which is what master opens on — the sentence cannot appear.**
    What remains is the static hover chip *"max 30m depth reached"* (`PriceChart.jsx:1874-1879`).

14. **And the sentence is a renderer-side inference, not a report.** It compares `candles.length`
    against `capBarsFor(interval)` (`timeframes.js:135-148`). The engine's own account of what
    happened — `syncInfo.reason`, `syncInfo.source`, `meta.barsAdded`, `matched`, `truncated` — is on
    the same payload and unused (fact 7). We *guess* at the shortfall while holding the measurement.

### A provider that returns fewer bars than asked

15. **A frame of 1–19 bars is thrown away entirely.** `fetch_history` requires `len(df) >= 20`
    (`providers.py:577`); otherwise it logs *"returned only N bar(s) … too few"* (`:582`) and returns
    `(None, "none")` (`:583`).

16. **Which makes a newly-listed instrument indistinguishable from a dead provider.** `store.sync`
    sets `info["reason"] = "no provider returned data"` and `info["providersTried"]`
    (`store.py:330-333`) and returns whatever was already stored — `None` for a new symbol. The route
    then takes the `df is None` branch and replies with the step-2 advisory again (`main.py:600-604`):
    **"Call again with sync=true to fetch it."** Master just did. The real reason exists, on the
    payload, and is shown nowhere.

### A provider error, or any engine exception

17. **The engine's own error message is dropped one layer below the renderer.** Any exception in the
    route becomes `HTTPException(500, detail=str(e))` (`main.py:685`). `http.cjs:192` — `getJson` — on
    a non-2xx returns `{ error: res.error || 'HTTP ' + status }` and **discards the body**.
    (`postJson` at `:200` keeps `raw`; `getJson` does not, and `/ohlcv` is a GET.) `getPath:189-190`
    then returns `{ ok: false, error: 'HTTP 500' }` with **no `detail` and no `stderrTail`** — those
    two fields exist only on the `ensureBackendRunning` gate object (`marketIntel.cjs:129-130`).
    **Master's amber line reads, literally, `HTTP 500`.**

18. **A failing sync is retried twice without telling anyone, and can run for minutes.**
    `http.cjs:28` sets `MAX_RETRIES = 2` and `getPath` passes no `retries` override, so the 90-second
    sync timeout (`marketIntel.cjs:215`) is attempted up to three times — roughly **270 seconds of
    "loading…" with no progress, no per-attempt state and no cancel** — and the engine re-runs the
    provider fetch on each attempt.

19. **Four failures against the origin re-introduce the bare-URL message Section 106 removed.**
    `CIRCUIT_THRESHOLD = 4` / `CIRCUIT_OPEN_MS = 20000` (`http.cjs:31-32`) and the open-circuit reply
    is `Circuit open for ${origin}` (`:107`). After a few failures master's error line becomes
    **`Circuit open for http://127.0.0.1:8001`** — a connection string as a headline, arriving through
    the transport layer rather than through the diagnosis path that was hardened against exactly this.

20. **Concurrent fetches are last-writer-wins.** `loadBars` holds no in-flight token and nothing in
    the page uses `AbortController` (grepped across `src/pages/StockMind/*.jsx`). The filter effect
    (`:370`) and the manual button (`:682`) can overlap; `setBarsBusy(false)` at `:228` fires for
    whichever returns first, so **the spinner clears while a 90-second sync is still running** and the
    empty overlay re-offers the button; and a stale 20-second disk read landing after the sync
    overwrites the synced bars at `:239`.

21. **There is no queue and no per-item state.** One symbol, one interval, one request, one boolean
    (`barsBusy`, `:177`). Fetching several instruments or several intervals is several manual presses
    with no list, no per-item outcome, no cancel and no retry-just-the-failed-one.

### The engine not running at all — FINDING ONE

22. **The bridge preserves the full diagnosis, and the StockMind tab shows it. It is NOT swallowed
    there.** `getPath:187-188` returns the gate object verbatim when the engine is down, and that
    object carries `error` (reason **and** remedy), `diagnosis`, `detail` and `stderrTail`
    (`marketIntel.cjs:123-131`). `loadBars` reads all three it needs (`StockMind.jsx:233-235`) and
    they render at `:746-767` — the amber sentence, a collapsible **engine output** `<pre>` with the
    engine's last stderr lines, and the `detail` line carrying the URL as a *detail*. The pure
    diagnosis function behind it is covered: **`node scripts/verifyEngineDiagnosis.cjs` → 34 passed, 0
    failed, measured in this worktree this session.**

23. **But the chart itself says nothing, and it is the chart master is looking at.** `PriceChart` has
    no error, note or diagnosis prop (prop list, `:257-283`). With the engine down the overlay
    (`:2093-2122`) renders *"No 30m bars stored for NIFTY50"* and a **⇩ Fetch & store them** button —
    **the exact action that just failed** — while the reason sits in a different card. In the
    WORKSPACE board that card is above the board; in a maximised panel or a popped-out window it is
    not on screen at all.

24. **A failed fetch leaves the previous interval's candles on screen under the new interval's
    label.** `loadBars` returns at `:237`, *before* `setBars(res.data?.bars || [])` at `:239`. Bars
    are cleared only when the symbol or exchange changes (`:377-385`, deps `[sym, exchange]`). So with
    the engine down, switching 30m → 1m leaves the 30m candles drawn under a `1m` header, and
    `barsMeta` — hence `coverage`, hence the date-picker `min`/`max` and the **⇤ beginning** button
    (`PriceChart.jsx:1834`, `:1841`, `:1845-1848`) — still describes the previous interval's store.
    **This is the same class of defect Section 105 fixed for symbols, re-entering through the error
    path.**

25. **The popped-out chart drops the engine's last words, and its fetch button does not fetch.**
    `PopoutPanel.jsx:104` keeps only `res.error` — the reason-plus-remedy sentence survives because it
    is inside that string, but `detail` and `stderrTail` are gone. Worse, `onFetch={loadBars}`
    (`:149`) and `loadBars` never passes `sync` (`:100-102`), so **⇩ Fetch & store them in a popped-out
    window re-reads the disk and calls no provider.** The button's label is false there.

26. **An engine that dies *after* `/health` answers is undiagnosed.** `diagnoseFailure` is consulted
    only on the path where the `/health` poll never answers (`marketIntel.cjs:40-131`). An engine that
    starts, answers `/health`, and then fails inside a 90-second provider fetch — a plausible shape on
    an interpreter with no `numpy` — produces fact 17's bare `HTTP 500`, or `Timeout after 90000ms`,
    with no diagnosis and no stderr.

## 1.2 Phase 1 verdict

**The engine-down diagnosis is surfaced, not swallowed — on one of three charts, in a card beside the
canvas rather than on it, and only for the one failure mode the gate was built for.** Everything else
in the fetch path degrades to a bare string: `HTTP 500`, `Timeout after 90000ms`, `Circuit open for
http://127.0.0.1:8001`, or silence.

And the deeper fault is not the error channel at all. **The requested window never reaches the
provider** (facts 4, 8, 9). Every other symptom — the un-followable advice, the holes, the absent
incremental fetch, the guessed shortfall — descends from that one architectural fact.

---

# PHASE 2 — AGAINST TRADINGVIEW'S DOCUMENTED CONTRACT

Sources, all read this session unless marked: TradingView's
[required datafeed methods](https://www.tradingview.com/charting-library-docs/latest/connecting_data/datafeed-api/required-methods)
and
[additional datafeed methods](https://www.tradingview.com/charting-library-docs/latest/connecting_data/datafeed-api/additional-methods);
plus the on-disk research for the non-TradingView comparators
(`docs/research/landscape-cluster-A.md`, `CHART_LANDSCAPE.md` §1.3(2), §1.4 *Published performance
ceiling*, §4(b)(7)).

**Content was rephrased for compliance with licensing restrictions.**

The thing worth internalising before the table: TradingView does not treat history as a thing you
request once. The library works out how many bars the chart space needs, asks for them, and **asks
again, repeatedly, as the user pans left**, ending the chain only when the datafeed says there is
nothing older. The window is a parameter of the request, the bar count is authoritative, and
end-of-history is an explicit flag. **Ours fetches a fixed lump up front and filters it afterwards.
That single difference generates most of the gap below.**

| # | TradingView's documented behaviour | Ours | What master experiences | The fix the design must deliver |
| --- | --- | --- | --- | --- |
| 1 | `getBars` receives a `periodParams` range — `from`, `to` (exclusive) — **and the window is part of the request** | `from`/`to` are applied by `main.py:618-636` **after** the store is read; `store.sync` (`store.py:301`) has no window parameter and `providers.py:374` sends a hard-coded `range=` constant | He picks a historical window, is told to "fetch more history", presses the button, and nothing changes (facts 8-9) | **Thread the window all the way down**: renderer → bridge → `/ohlcv` → `store.sync` → `fetch_history`. Where a capped interval cannot serve it, refuse *with the reason* instead of silently serving a different window |
| 2 | `countBack` — the number of bars needed — is **more authoritative than the time range**, because the range can be mis-derived | `limitForDates` (`timeframes.js`) computes a ceiling from dates; `main.py:647` takes `window.tail(limit)`. Nothing relates it to the pixels available | The chart sometimes shows fewer bars than the window implies, with `matched`/`truncated` computed and never shown (fact 7) | Carry a wanted-bar-count beside the window, and **report `matched` and `truncated` on screen** rather than inferring from `candles.length` |
| 3 | `getBars` is called **repeatedly as the user scrolls back**; history is paged lazily on demand | One window up front. Panning left runs out of array and stops | Deep history is reachable only by typing dates that do not work (fact 9) | A **load-older path**: extend the stored range from the left edge, on demand, with its own visible state |
| 4 | `noData: true` ends the chain — **end-of-history is an explicit signal** | No end-of-history concept. "Nothing stored", "nothing exists at the provider", "the provider refused" and "the engine is down" all render as one empty overlay (`PriceChart.jsx:2093`) | He cannot tell "there is no more" from "something broke" (facts 3, 16, 23) | **Three distinct states on the canvas**: no data yet, no data upstream, could-not-ask — the last carrying the diagnosis |
| 5 | If the range holds fewer bars than `countBack`, **return what exists plus earlier bars**; do not return nothing | A frame under 20 bars is discarded outright (`providers.py:577-583`) | A thinly-traded or newly-listed instrument reports the same thing as a dead provider, with the advisory that tells him to retry what he just did (fact 16) | **Store what arrived** and report the count honestly. A 7-bar answer is 7 bars plus a sentence, not a failure |
| 6 | The library caches history itself, so the datafeed need not — and when historical values **change**, the integrator calls `resetCache` then `resetData` to force a redraw | Our store is primary rather than a cache, which is the right call for a reproducible backtest — but there is **no invalidation story**. `merge` silently corrects existing rows (`store.py:188`) with nothing recording that it did | A corrected bar appears, or does not, with no account of it. Zerodha publishes the matching cautionary fact: candle values can change after a refresh once a corporate action lands (on-disk research, §1.4) | Record **which ranges are held and at what revision**, and give the chart an explicit "these bars changed, redraw" path |
| 7 | `getMarks` / `getTimescaleMarks` are requested **for the visible range only** | No marks surface at all; `news.py` holds dated classified events but exposes no series-by-window endpoint (on-disk research, §2.13) | Events are not on the chart (a known later-phase gap, not this task) | When marks are built, make them **window-queryable from day one** — building them wholesale would be a migration |
| 8 | Bars must arrive in ascending time order, and **daily/weekly/monthly bars carry 00:00:00 UTC**, not a session time | `chartTime.js` already holds the dual time type: a daily bar is a calendar date and is never zone-converted; intraday is true UTC, with only labels localised. `main.py:656-658` serialises each form correctly | Correct today | **Do not touch.** `verifyChartTime.mjs` (197 assertions) is the enforcement; this row is confirmation, not a gap |
| 9 | A saved layout **deliberately excludes the visible range**; the library re-opens on the newest data and exposes `setVisibleRange` as an explicit post-load call | `chartZoom.js` applies an initial-range policy after data load with a measured read-back | Settled (§123.6 decision 2) | **Do not re-litigate.** Any new paging behaviour must apply the zoom policy *after* bars land, not fight it |
| 10 | `resolveSymbol` has its own error callback and a documented unknown-symbol state; `getBars` has an error callback — **failures are a channel, not a string** | One amber string. For GET failures the engine's `detail` is dropped at `http.cjs:192`; `PriceChart` has no error prop at all | `HTTP 500`, `Timeout after 90000ms`, `Circuit open for http://127.0.0.1:8001` (facts 17-19, 23) | **Carry the engine's body on a `getJson` failure** (one additive change inside the single I9 client, matching `postJson`'s existing shape), and **give `PriceChart` an error prop** so the failure appears where he is looking |
| 11 | MT5 publishes a `Max. bars on chart` setting and a 512-bar initial load that grows as you scroll; IBKR publishes a `Show # bars` contract with an enforce switch (on-disk research, §1.4) — the loading contract is **visible before the request** | `beyondCap` ⚠ on the preset (`PriceChart.jsx:1800`) is genuinely in this spirit; but the post-fetch shortfall sentence is unreachable on the default unfiltered view (fact 13) and is **inferred rather than reported** (fact 14) | He is warned before, then told nothing after — on the one view he opens on | State the contract **and** the outcome: what was asked, what the provider caps at, what arrived, and from whom — using `syncInfo` and `meta`, which already cross the wire |
| 12 | *(no equivalent anywhere — 0 of 22 researched surfaces)* | Nothing identifies holes in a growing store (fact 11) | A chart draws a continuous line across missing sessions | **Coverage as a set of ranges, not a span** — and then the asked-but-absent / beyond-cap bands §4(b)(7) already designs, reusing `shortfallNote()` and `describeLimit()`. This is ours alone and it is the honest half of "fetch and store" |

## 2.1 The gaps the design must resolve, in priority order

1. **The requested window must reach the provider.** Everything else is downstream of this.
2. **Coverage must be a set of ranges**, so a hole is nameable, drawable, and fillable — and so an
   incremental fetch has something to be incremental against.
3. **The fetch must report itself.** `syncInfo.reason`, `syncInfo.source`, `meta.barsAdded`,
   `matched`, `truncated` already arrive at the renderer and are discarded. Showing them is cheap and
   removes the "did that do anything?" class of defect entirely.
4. **The failure channel must survive the transport.** `getJson` must keep the engine's body, and the
   canvas must be able to show a failure instead of an invitation to repeat it.
5. **`coverage` must reach all three call sites, and the popout's fetch button must actually fetch.**
   Two of three charts cannot bound their date pickers, cannot show what is stored, and cannot shade
   what is missing; one of them lies about what its button does.
6. **A long fetch needs progress, a cancel, and an in-flight token.** Up to 270 seconds of a boolean
   spinner, with last-writer-wins on the result, is not a loading state.

---

# ⚠ NOT VERIFIED — read before acting on anything above

**Nothing in this document was seen on a screen.** No chart was rendered, no fetch was executed, no
engine was started. Every Phase 1 fact is read off source. Specifically:

- **Everything needing the Python engine is unexecuted.** This machine's Python is 3.14 with no
  `numpy`/`pandas`/`sklearn`, so `ai_backend/engine/providers.py`, `store.py` and `main.py` **cannot
  be imported here**. Facts 4, 6, 8, 9, 10, 11, 15, 16 and 17 are derived by reading Python control
  flow, not by running it. In particular: the cooldown arithmetic in `is_stale`, the exact bar counts
  Yahoo returns for each `INTRADAY_RANGE` value, and the claim that a `>= 20`-bar filter discards a
  real-world thin series are **read, not measured**.
- **The hole-formation scenario (fact 11) is a reasoned consequence, not an observation.** It follows
  from a fixed fetch window plus a union merge plus a provenance record that holds only a count and a
  span. It has not been reproduced on disk, because reproducing it needs the engine.
- **`vite build` cannot be run in this worktree** — `node_modules` is installed in the main workspace
  only. No claim is made that the renderer builds. The dependency-free suites do run here;
  `verifyEngineDiagnosis.cjs` was measured green (34/34) this session and is the only measurement in
  this document.
- **The circuit-breaker consequence (fact 19) is inferred from `http.cjs` constants**, not observed.
  Whether master has actually been shown `Circuit open for http://127.0.0.1:8001` is unknown; the code
  path exists and is reachable.
- **Fact 24 (stale candles under a new interval label) has not been seen.** It follows from an early
  `return` at `StockMind.jsx:237` and a clear-effect keyed on `[sym, exchange]` only. It is the single
  claim here most worth confirming on a screen before it is designed against.
- **The Phase 2 TradingView rows were retrieved live this session** from
  `tradingview.com/charting-library-docs` (required methods, additional methods). A third page,
  `connecting_data/Datafeed-Subscriptions`, returned **HTTP 404** — the `resetCache` / `resetData`
  fact in row 6 therefore comes from the required-methods page, which states it, and not from a
  dedicated subscriptions page.
- **The non-TradingView comparators in rows 11 and 12 are quoted from the on-disk research**
  (`CHART_LANDSCAPE.md` §1.4, `landscape-cluster-A.md`), not re-retrieved. Those cells carry whatever
  confidence that document assigned them — Cluster C there is explicitly unverified and nothing from
  it is used here.
- **No source file was modified by this document.** `RAMA_AGI_MASTER_SPEC.md` was read and not
  changed.
- **One pre-existing engine defect, recorded and not touched** (carried forward from §123.7, still
  true): `dispatcher.LOT_SIZES` says `NIFTY: 25` while `strategy_spec.py` says 75 in two places. It is
  unrelated to fetch-and-store and remains out of scope.

---

# PHASE 3 — THE DESIGN (renderer and bridge half only)

**Date.** 2026-10-02, same session, same worktree (`.worktrees/fetch-store`, branch
`chart/fetch-and-store`, HEAD `9669eea`). Phase 1 facts and Phase 2 rows are referenced by number
below and are **not** re-derived.

**Revision 3 (same session).** Revision 2 was reviewed against source a second time
(`docs/research/design-review.md` + `design-review.json`, verdict `CHANGES_REQUESTED`, **4 HIGH / 14
MEDIUM / 3 NIT**) and is rewritten here. Every HIGH and MEDIUM is resolved in place; the per-finding
disposition is in §3.15. Read §3.15 before implementing: the four HIGH findings were *the design
disagreeing with the code it lands on, or with itself*, not matters of taste, and two of them
(`classifyOutcome`, the in-flight token) sat directly on this task's own goal of never lying about
what a fetch did. Every claim about existing code in this revision was **re-read off source in this
worktree** at HEAD `9669eea`; where the reviewer's line numbers and mine differ, mine are used and
the landmark is named in words as well, so a later session can find it after the file moves.

**Scope boundary, stated once.** Everything specified in §3.1–§3.9 lives in `src/pages/StockMind/*`,
`electron/lib/http.cjs`, `electron/ipc/marketIntel.cjs`, `electron/preload.cjs` and `scripts/*`. The
Python engine is **not** touched: it cannot be imported on this machine (no `numpy`/`pandas` for
Python 3.14), so an engine edit would be an unverifiable blind change. §3.10 specifies the engine
tranche precisely — signatures, parameters, payload fields — and every renderer surface that depends
on it is designed to **degrade by saying so**, never by pretending.

## 3.0 Overview

The fetch path today is one boolean (`barsBusy`), one string (`barsNote`) and a payload most of whose
fields are discarded. The design replaces that with five small, pure, separately testable pieces and
wires them into the three existing `PriceChart` call sites:

| Piece | New module | What it owns |
| --- | --- | --- |
| **The contract** | `fetchContract.js` | what a request WILL do, computed and shown **before** it is sent; how fresh the answer is; and the capability-retention rule |
| **The queue** | `fetchQueue.js` | two lanes, named states, a real cancel, an explicit retry, the outcome classification, and the two guards that end last-writer-wins |
| **The coverage model** | `chartCoverage.js` | stored history as a **set of ranges**, so a hole is a nameable object |
| **The coverage layer** | `ChartCoverageLayer.js` | that set of ranges, drawn under the candles — the third series primitive, shaped like the two that exist |
| **The empty state** | `chartEmptyState.js` | which of **three** distinct nothings the canvas is showing, the failure text when it is the third, and the wording of the `why?` answer |

Four of the five are dependency-free ES modules with no React and no charting library in them, so they
are covered by a new `node`-runnable suite (`scripts/verifyFetchStore.mjs`) in a worktree where
`vite build` cannot run. That split — model pure, pixels thin — is the one `chartSessions.js` /
`ChartSessionLayer.js` already established, and it is reused rather than reinvented.

**Technology stack, locked by this design.** **React 19** function components with hooks (`react` and
`react-dom` are both pinned `19.2.0` in `package.json`) — no new state library, no reducer framework;
plain ES modules for the pure half; the existing `lightweight-charts` (pinned `5.2.1`)
series-primitive interface for the new layer; hand-rolled `check()` suites in `scripts/` matching the
existing `.mjs`/`.cjs` convention; Electron `ipcMain.handle` / `contextBridge` for the bridge.
**No dependency is added.** Nothing here needs one: range arithmetic is integer comparison, the hatch
is a `canvas` fill, and the queue is an array.

**Where each thing is computed — settled once, because revision 2 left it implicit and the review
found two consequences of that.** `PriceChart` already holds `candles`, `starts`, `interval`,
`rangeId`, `fromDate`, `toDate`; so **`PriceChart` computes the coverage model and its own request
contract from its own props**, and the `coverage` prop carries only facts the chart cannot derive —
the *store's* first/last/count/stamp. Three consequences, all wanted: the popout and the workspace
panel get bands and a contract sentence with no extra wiring (§3.6), there is no `contract` prop to
drift out of step with the chart it describes, and the alignment hazard of handing a chart a parallel
array disappears (§3.2). `StockMind.jsx` calls the *same* `describeRequest()` for the sentence beside
its two load buttons — one function, two render sites, no second opinion.

## 3.1 DECISION 1 — Keep window fetching. Do **not** adopt lazy paging on scroll-back.

**Decision.** Reject the `getBars` + `noData` paging pattern as our fetch trigger. Keep a
**master-initiated window fetch**, and add an explicit, visible **"older" request** that is itself a
window fetch rather than a scroll callback. Adopt two *parts* of TradingView's contract — the
authoritative bar count beside the window, and an explicit end-of-history signal — because those are
about honesty, not about paging.

**Reasons, in order of weight.**

1. **Our store is primary, theirs is a cache.** TradingView pages lazily because the library holds no
   durable history and the datafeed is a server with effectively unbounded depth; the local cache it
   maintains is exactly the thing we already have on disk (`store.py`, and §1.0 hop 10's union
   `merge`). Paging on pan would make a **network** operation out of a gesture whose data is, after
   the first fetch, **local**. The expensive, capped, rate-limited half of our system would be driven
   by a mouse wheel.
2. **The caps are hard and small, so the chain terminates immediately and uselessly.**
   `PROVIDER_CAP_SESSIONS` caps six intervals — `1m: 5`, `2m: 5`, `5m: 21`, `15m: 21`, `30m: 21`,
   `60m: 504` sessions — and leaves `1d`/`1wk`/`1mo` at `null` (`timeframes.js`, the
   `PROVIDER_CAP_SESSIONS` table). All six are written out because the same list is the drift contract
   `verifyTimeframes.mjs` checks against the Python. A pan-triggered chain on a 1m chart would reach
   `noData` on its first or second call, every time, for every instrument. The pattern's payoff — deep
   history arriving as you explore — cannot occur here. What would occur is repeated no-op provider
   calls, which is fact 6 and fact 7 (a fetch that reaches nothing and says nothing) **automated**.
   **And the cap is a *rolling* window, not merely a maximum width** — `providers.py` interpolates
   `INTRADAY_RANGE` into a `range=` string (`1mo` for 30m), which is "the last month", not "any month"
   — which is why the `⇠ older` affordance below needs a *position* clamp and not only a depth
   figure. The rolling reading is **read off the request shape, not observed**, and §3.14 records it
   as the open question it is.
3. **An automatic fetch cannot carry a contract.** Decision 3 requires master to see what a request
   will ask for before it is sent (MT5/IBKR precedent, Phase 2 row 11). A pan gesture has nowhere to
   put that, and a request whose terms were never shown is the thing this whole task exists to remove.
4. **It would fight a settled decision.** §123.6 decision 2 settles `chartZoom.js`; Phase 2 row 9
   requires any new load behaviour to apply the zoom policy *after* bars land. Data arriving as a
   side-effect of a visible-range change, which then re-applies a visible-range policy, is a feedback
   loop with the measured read-back in the middle of it. Not worth the risk to a surface master has
   already reported broken three times.

**What is adopted instead, concretely.**

- `PriceChart` gains one optional callback, `onLoadOlder = null`. When supplied **and** the visible
  logical range's `from` falls within `OLDER_PROMPT_BARS = 20` of index 0, a chip appears at the left
  of the chip row: **`⇠ older`**, whose title is the request contract for that older window (§3.3). It
  is a **prompt, not a fetch** — pressing it calls `onLoadOlder({fromDate, toDate})`; reaching the
  edge does not. Nothing auto-fetches, ever.
- **How the chip learns about a pan — this is a correction, and it matters.** `PriceChart` has
  exactly one `subscribeVisibleLogicalRangeChange` handler and it early-returns when the
  quarter-pixel-rounded px-per-bar is unchanged (`PriceChart.jsx:758-763`,
  `if (step === lastPxRef.current) return;`). A pure left pan changes `range.from` and **not** the bar
  width, so that guard would swallow exactly the gesture the prompt exists for. The edge test is
  therefore tracked **inside the existing subscription, above the dedupe**, and no second subscription
  is added — a second one would interact with `chartZoom`'s measured read-back, which §123.6 decision
  2 settles:

  ```js
  chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
    // Tracked ABOVE the px-per-bar dedupe: a pan changes `from` and not the bar width, so the zoom
    // guard would swallow the one gesture the older-prompt exists for.
    const from = finite(range?.from) ? range.from : null;
    setNearLeftEdge(from !== null && from <= OLDER_PROMPT_BARS);
    const width = plotWidth(chart, holder.current);
    const actual = pxPerBar(range, width);
    const step = actual === null ? null : Math.round(actual * 4) / 4;
    if (step === lastPxRef.current) return;      // the existing zoom dedupe, unchanged below here
    …
  });
  ```

  The chip **reads** `range.from` and never calls `setVisibleRange` / `setVisibleLogicalRange` —
  asserted in §3.12 by source reading.
- **The cap check is null-guarded AND measured off the store, not off the payload.** Two separate
  traps, one line. `capBarsFor` returns `null` for `1d`/`1wk`/`1mo` and `anyNumber >= null` coerces to
  `>= 0`, which is always true — so an unguarded comparison hides the chip on every daily chart and
  replaces it with `describeLimit(interval)`, which is *also* `null` there: neither the affordance nor
  the sentence, just a blank. And `candles.length` is **the date-filtered payload**, not the store, so
  measuring the ceiling against it would be fact 14 and Phase 2 row 2 — *guessing at the shortfall
  while holding the measurement* — committed by the very design that names it:

  ```js
  // `coverage.stored` is the STORE's own count (the route returns `stored` beside `matched` and
  // `count`); `candles.length` is this payload after the display filter. Prefer the measurement,
  // fall back to the inference only when the store was not described.
  const held = Number.isFinite(coverage?.stored) ? coverage.stored : candles.length;
  const cap  = capBarsFor(interval);          // null => no provider cap for this interval
  const atCap = cap != null && held >= cap;
  // Uncapped intervals (1d/1wk/1mo) never reach a provider ceiling, so the chip STAYS and no limit
  // sentence is rendered — absent by definition, not by omission.
  ```

  When `atCap` is true the chip is replaced by `describeLimit(interval)`, which is the existing voice:
  *"Free data for 30m bars reaches back 1mo — about 263 bars. Deeper windows are refused by the
  provider, not by Rāma."* (263, measured: `ceil(21 × 375 / 30)`.) A limit reported as a limit, not a
  dead button and not a refusal.
- **End-of-history is explicit** (Phase 2 row 4). Three canvas states, never one overlay — §3.5.
- **The bar count travels beside the window, and it is not 20,000.** `limitForDates` short-circuits
  to `MAX_BARS` when `from` is falsy, and the default view is 30m with no dates — so inheriting it
  would make the contract sentence claim master asked for twenty thousand bars. `describeRequest`
  therefore defines the figure rather than inheriting it (§3.3), and the outcome report prints the
  engine's own `matched` / `count` / `barsAdded` rather than inferring a shortfall from
  `candles.length`.

**The older window, computed where it can be checked.** `fetchContract.olderWindow(rawBars,
intervalId, now)` returns a **discriminated result**, not a bare `null`, because the caller needs to
know *which* unavailability it is looking at in order to say the right sentence:

```
olderWindow(rawBars, intervalId, now) ->
  { ok: true,  fromDate, toDate, clampedToHorizon: boolean }
| { ok: false, reason: 'no-bars' | 'bad-anchor' | 'unknown-interval' | 'beyond-retention' }
```

- The anchor is `String(rawBars[0].date).slice(0, 10)` — a **string slice off the engine's own
  stamp**, never a parse and never a zone conversion. The engine filters with `pd.Timestamp(fromDate)`
  against stored stamps in the same naive frame, so a date sliced off a stored stamp is already in the
  right frame. `chartTime.js` is not consulted and not duplicated.
- `toDate` is the anchor **itself**, not the day before it: a partially stored session must be
  completed, and `merge` is a de-duplicating union, so the overlap costs one request's worth of rows
  and nothing else.
- Depth is `PROVIDER_CAP_SESSIONS[intervalId]` sessions when capped, else `252` (one year) — the same
  figure `store.sync`'s top-up path uses for an existing store (`want_years = years or (30 if stored
  is None else 1)`).
- Sessions become calendar days with the `ceil(sessions × 365 / 252) + 3` arithmetic `datesForRange`
  uses, via one local helper `ymdMinusSessions(ymd, sessions)`. **That arithmetic is duplicated**,
  because `datesForRange` is anchored on *today* and this window is not, and `timeframes.js` is on the
  do-not-touch list. The duplication is made safe rather than hidden: §3.12 asserts that `olderWindow`
  over a today-anchor agrees date-for-date with `datesForRange` for the same session count.
- **The retention clamp, which is the half revision 2 was missing.** A provider that serves "the last
  21 sessions" cannot serve sessions 22–42 however the request is phrased. So the window is clamped on
  **position**, not only on width:

  ```js
  // Capped intraday intervals are a ROLLING window at the provider. An older window that ENDS before
  // `now - cap sessions` is not a deep request, it is an unservable one — and an affordance that
  // cannot do what it says is fact 9 with a nicer button.
  const capSessions = PROVIDER_CAP_SESSIONS[intervalId];
  if (capSessions != null) {
    const horizon = ymdMinusSessions(toYmd(now), capSessions);
    if (toDate < horizon)   return { ok: false, reason: 'beyond-retention' };  // string compare is
    if (fromDate < horizon) { fromDate = horizon; clampedToHorizon = true; }   // valid on YYYY-MM-DD
  }
  ```

  On `ok: false` with `reason: 'beyond-retention'` the chip is replaced by `describeLimit(intervalId)`
  — the same treatment as `atCap`, for the same reason. On the other three reasons nothing is rendered
  at all (E4). On `clampedToHorizon` the contract sentence says so: *"…and it will reach back only to
  {horizon}, because free 30m data is the last 21 sessions and not an arbitrary month."*
- `ok: false` with `reason: 'no-bars'` when there are no bars, `'bad-anchor'` when the anchor does not
  match `^\d{4}-\d{2}-\d{2}$`, `'unknown-interval'` when the interval does not resolve.

**Honest degradation until §3.10 lands.** `store.sync()` has no window parameter today, so an "older"
job cannot actually ask the provider for an older window. The chip is therefore rendered **only** when
the capability is known to exist — `supportsWindowedSync(supports) === true` (§3.2's retention rule).
Until the engine tranche sets that flag the chip is **absent and its reason is present**: the coverage
note reads *"Rāma cannot yet ask the provider for a specific older window — it serves a fixed window
per interval, so an older request would re-fetch the same bars. What is stored is shown above."* An
affordance that cannot do what it says is fact 9 repeated, and this is the guard against repeating it.

## 3.2 DECISION 2 — The gap model: detected from bars, represented as ranges, drawn as bands, filled only when it can be

**Detected.** New pure module `src/pages/StockMind/chartCoverage.js`.

```
coverageRanges(candles, intervalId, opts) -> {
  held:   Array<{from, to, bars}>,          // contiguous runs actually on screen (chart times)
  gaps:   Array<{from, to, fromYmd, toYmd, kind, bars, text}>,
  source: 'bars' | 'store',                 // where the model came from
  leftEdge: 'store' | 'payload-ceiling',    // see edge case E1
  degraded: null | 'no-dates' | 'no-sessions' | 'mixed-times' | 'unknown-interval',
}
```

`intervalId` is **the id string**, not a descriptor object, because `INTERVALS` is an *array* of
descriptors and the accessor is `interval(id)` — `INTERVALS[id].span` would be `undefined.span`, a
`TypeError` thrown inside a render, which §3.7 forbids this module from ever doing. It is resolved
once, at the top, and an unresolved id returns the empty model:

```js
import { interval as intervalDef, PROVIDER_CAP_SESSIONS } from './timeframes.js';

export function coverageRanges(candles, intervalId, opts = {}) {
  const iv = intervalDef(intervalId);
  if (!iv) return EMPTY('unknown-interval');
  const stepMin = iv.span;      // SESSION minutes; equals clock minutes for every intraday interval
  …
}
```

`candles` is the already-converted array `PriceChart` builds (times from `toChartTime`), so this
module **never** parses a stamp and **never** decides a time type. `chartTime.js` is not touched and
not duplicated — the same rule `chartSessions.js` states and obeys.

**Two injected inputs, both `Map`s, both refused when misshapen.** Revision 2 made `opts.ymd` a
parallel array and called it *"the same injection style as `sessionBands`"*. It is not, and the
difference is not cosmetic: `candles` is built from `bars` by a `map` that **drops** any bar with an
unparseable time or a non-finite price and then **de-duplicates** consecutive equal times
(`PriceChart.jsx:533-543`), so `candles[i]` and `bars[i]` are **not** the same bar as soon as one bar
is dropped. A parallel array of the right length would then be silently misaligned — a date attached
to the wrong candle, which is worse than no date. So:

| Input | Shape | Validation | When unusable |
| --- | --- | --- | --- |
| `opts.ymd` | `Map<number\|string, 'YYYY-MM-DD'>` keyed by **candle time** | every key is a usable time, every value matches `^\d{4}-\d{2}-\d{2}$`, size > 0 | daily-or-coarser falls back to the candle time itself (which already *is* `'YYYY-MM-DD'`); **intraday returns the empty model with `degraded: 'no-dates'`** |
| `opts.starts` | `Map<'YYYY-MM-DD', number>` — the map `PriceChart` already builds at `PriceChart.jsx:563` and hands to `sessionBands` | the `injectedStarts` rule verbatim: a `Map`, non-empty, every key `^\d{4}-\d{2}-\d{2}$`, every value a usable time; one bad entry refuses the whole map | **intraday returns the empty model with `degraded: 'no-sessions'`** rather than guessing which steps are overnight |

`opts.ymd` is built **inside the same `useMemo` that builds `candles`**, from the raw bar that produced
each candle, so the alignment question cannot arise at all. The refusal pattern is re-stated in
`chartCoverage.js` rather than imported, because `injectedStarts` is a module-private function in
`chartSessions.js` and `chartSessions.js` is on this tranche's do-not-touch list; §3.12 asserts the
two refusals agree.

**The `no-sessions` refusal is the important one.** Without a usable `starts` map every overnight step
on an intraday chart is a step larger than one bar width — so every night would become a `hole` band,
which is the chart asserting a false fact about the market. An unmodelled chart is better than a
falsely modelled one, and `describeCoverage` says which.

Contiguity, per interval:

- **Intraday** (`iv.intraday === true`): the expected step between neighbours is `stepMin` minutes. A
  step larger than `GAP_FACTOR = 1.5 ×` that is a candidate — **unless the two bars are in different
  sessions**, read from `opts.starts`. An overnight step is not a hole; that is what
  `chartSessions.js` exists to make visible.
- **Daily and coarser**: the step is counted in **business days** between two `'YYYY-MM-DD'` strings.
  A gap of `<= HOLIDAY_TOLERANCE_DAYS = 3` business days is **not reported**, because NSE holiday runs
  of one to three sessions are routine and calling a Diwali closure a hole would be Rāma asserting
  something false about the market. This is a **stated heuristic, not a measurement**, and the label
  it produces reflects that: a band says *"no bars stored here"* — which is true whatever the cause —
  and never *"data missing at the provider"*, which we cannot know without the engine.
- A candidate must also span `>= MIN_GAP_BARS = 2` missing bars. One absent bar is below the
  resolution at which a band is readable, and `ChartSessionLayer` already refuses a sub-pixel stripe
  for the same reason.
- **Mixed time types return the empty model** with `degraded: 'mixed-times'` — the same refusal
  `sessionBands` makes, for the same reason (Sections 117/118). A partially modelled chart is worse
  than an unmodelled one.

Three `kind`s, and they are different claims:

| `kind` | Meaning | Label source | Claim class |
| --- | --- | --- | --- |
| `hole` | a run of missing bars **between** two stored runs | own sentence, from the range | `reflex` — it states what the store handed over |
| `asked-absent` | between the window master requested and the first/last stored bar | `shortfallNote()` where it applies, else a sentence naming the two dates | `reflex` |
| `beyond-cap` | older than `PROVIDER_CAP_SESSIONS[intervalId]` sessions | `describeLimit()` — existing voice, unchanged | `reflex` |

**`asked-absent` cannot exist on the default unfiltered view, and that is correct, not a bug.** It
needs a requested window, and `shortfallNote` returns `null` when `rangeId` is null or the interval is
uncapped. On the default 30m view with no dates — the view master opens on, and the subject of fact 13
— there is no requested window, so no `asked-absent` band can be drawn by construction. What covers
that view is the contract line (§3.3) plus the `beyond-cap` tint. Stated here so a later session does
not read the absence as a defect and "fix" it into a false band.

This is §4(b)(7) of `CHART_LANDSCAPE.md` built, plus the `hole` kind that row did not have because
`coverage` was a span. It is also the item §123.6 decision 8 deferred *"one tranche"* on the explicit
condition that `coverage` first reach all three call sites — which §3.6 does, in the same change.

**Represented.** The `coverage` prop becomes a superset and stays backward compatible: `{first, last}`
keeps working exactly as it does. There are **three** existing readers, all of which read only those
two keys — the date-picker `min`/`max` (`PriceChart.jsx:1834-1842`), the **⇤ beginning** button
(`:1845-1848`), and the provenance line `stored {first} → {last || 'now'}` (`:1868-1872`). Added, all
optional:

```
coverage = { first, last,                     // unchanged, still the only required pair
             stored?: number,                 // the STORE's bar count, from the route's `stored`
             fetchedAt?: string|null,          // meta.lastFetchedAt — STORE-level, see §3.3
             source?: string|null,             // meta.lastSource
             truncated?: boolean,              // the route's own `len(bars) < matched`
             ranges?: Array<{from, to, fetchedAt?, source?}> }   // §3.10 item 5; absent today
```

A caller that passes the old shape gets the old behaviour and no bands; **no existing call site
breaks** (I11).

**Shown.** New `src/pages/StockMind/ChartCoverageLayer.js`, a third series primitive copied in shape
from `ChartSessionLayer.js`: `attached` / `detached` / `paneViews` / `updateAllViews` / `redraw`,
state read live on every draw, `zOrder: () => 'bottom'`, x-coordinates only — so like the session
layer it **cannot be wrong about a price, because it converts none**. `timeToCoordinate` returning
`null` is honoured, never clamped to the plot edge: a band drawn to the edge would claim the hole
extends past the data, which is the same lie as painting an unloaded afternoon.

Drawing rules: `hole` and `asked-absent` are **diagonal hatch** at low alpha in the muted text colour;
`beyond-cap` is a **flat tint**, fainter still. Three visual weights for three different claims, and
none of them borrows green, red, the accent or master's magenta — every one of those is already a
claim elsewhere (the rule `ChartSessionLayer` states). A chip `coverage (n)` appears **only when
`n > 0`** — the hidden-when-nothing-to-shade rule the `sessions (n)` chip already follows
(`PriceChart.jsx:2060-2069`) — toggles the layer, and carries `<InfoTip id="coverageGap" />` beside
it exactly as the sessions chip carries `sessionBand`. One line under the canvas, from
`describeCoverage(...)`, and the same sentence joins the canvas `aria-label`, exactly as `bandNote`
does (`PriceChart.jsx:2141`).

**Filled.** Bands are **not interactive**. The layer is canvas, and hit-testing it would drag in the
pointer machinery `ChartDrawingLayer` carries, for a target a few pixels wide. Instead the coverage
note under the canvas lists up to `MAX_LISTED_GAPS = 3` holes, newest first, each with a **`fill`**
button, plus a **`fill all`** button when there are more:

```
describeCoverage(model, intervalId, { supports, listMax = MAX_LISTED_GAPS }) -> {
  text:    string,
  actions: Array<{ id: 'fill' | 'fill-all',
                   label: string,              // '⇩ fill 14 Mar – 18 Mar' / '⇩ fill all 12 gaps'
                   from: 'YYYY-MM-DD',         // for 'fill-all', the oldest listed window's start
                   to:   'YYYY-MM-DD',
                   windows: Array<{from, to}>, // length 1 for 'fill', n for 'fill-all'
                   title: string }>,           // the per-window request contract (§3.3)
}
```

**And every one of those actions is gated on the retained `windowedSync` capability.** Until the
engine tranche lands `actions` is `[]` and the §3.1 sentence is in `text` instead. The gate lives in
the **pure function** and is asserted there (§3.12) rather than being a JSX condition nobody tests.
This is the single most important guard in the design: fact 9 is *"the message names a remedy the
system does not implement"*, and a `fill` button that re-fetches the provider's fixed window would be
that defect with a nicer affordance.

**`fill all` against a queue of eight — the limit is reported, never silently applied.** Twelve holes
and `MAX_QUEUE = 8` provider slots is a limit, and `timeframes.js`'s voice says a limit is stated, not
enforced in silence. `describeCoverage` builds **all** the windows; `fetchQueue.enqueueAll(state,
jobs)` accepts as many as the free provider-lane capacity allows, in newest-first order, and returns
`{state, accepted, rejected, note}` where `note` is *"4 of 12 gaps were queued; the fetch queue holds
8 at a time, so press ⇩ fill all again when these finish."* Nothing is dropped unreported, and
nothing is queued past the cap. §3.12 asserts the 12-against-8 case by number.

**Capability retention — absence is not withdrawal, and a capability is not per instrument.** The page
issues `loadBars(false)` on mount and on every filter change (`StockMind.jsx:355-363`, `:369-372`),
and a plain disk read's `syncInfo` is the literal `{"fromStore": True}` (the route's non-sync branch)
with no `supports` key at all. So a naive `syncInfo.supports?.windowedSync === true` read would make
every gated affordance appear after a sync and vanish on the next automatic read. The rule, held in
`fetchContract.js` as a pure function so it is testable:

```js
// A capability is a property of the ENGINE BUILD, not of a reply and not of an instrument. A reply
// that does not mention `supports` is silent about it, and silence never revokes. Only an explicit
// object whose windowedSync is not strictly true closes the gate.
export function mergeSupports(prev, next) {
  if (next == null || typeof next !== 'object') return prev ?? null;
  return next;
}
export function supportsWindowedSync(s) { return s?.windowedSync === true; }
```

**One page-level value holds it** — `const [supports, setSupports] = useState(null)`, updated with
`setSupports((prev) => mergeSupports(prev, reply?.data?.syncInfo?.supports))` on **every** `ohlcv`
settle whatever its outcome. Not a map keyed by symbol and interval: there is one engine, one build,
one capability set, and keying it per instrument would hide every gated control on each symbol switch
until a sync happened there — the flicker the retention rule exists to prevent, re-entered through the
key. There is therefore no `MAX_SUPPORTS_KEYS` and no eviction rule; the bounded map that needed them
does not exist. Strictness is deliberate: `'yes'`, `1` and `'true'` all leave the gate closed (§3.12
asserts it), because a truthy-but-wrong flag is exactly how a renderer claim outruns an engine.

## 3.3 DECISION 3 — The request contract, visible before the request

**Decision.** A pure `describeRequest()` computes the terms of a request, and those terms are rendered
**beside the button that would send it** — on the controls card, on the empty-state overlay, and in
the fetch chip's title — before anything is sent. MT5 publishes `Max. bars on chart` and its 512-bar
initial load; IBKR publishes `Show # bars` with an enforce switch; both state the loading contract up
front (`CHART_LANDSCAPE.md` §123.3, the published-ceilings row). Ours states it and then **also
reports the outcome against it**, which is the half fact 13 and fact 14 are missing.

New module `src/pages/StockMind/fetchContract.js`:

```
describeRequest({ intervalId, fromDate, toDate, rangeId, mode, supports, queue, selection }) -> {
  mode:            'disk' | 'provider' | 'older' | 'gap',
  wantBars,                       // see below — NOT limitForDates' raw return
  wantBarsIsCeiling: boolean,     // true when no window was selected
  capBars,                        // capBarsFor(intervalId)            — existing; null when uncapped
  providerWindow,                 // PROVIDER_RANGE_STRING[intervalId] — existing; null when uncapped
  windowReachesProvider,          // === supportsWindowedSync(supports)
  willStore:        boolean,      // false for 'disk'
  blocked:          string|null,  // a reason the request must not be sent at all
  caveats:          string[],
  text:             string,       // one sentence, for a title or an inline line
}
```

Every number in it comes from `timeframes.js`, which is therefore **not modified**: `limitForDates`,
`capBarsFor`, `PROVIDER_RANGE_STRING`, `describeLimit` and `shortfallNote` are all already exported
and all already carry the agreed voice. A second module writing its own sentences about provider
limits would be a second opinion about them.

**`wantBars` is defined here, not inherited.** `limitForDates(id, from, to)` returns `MAX_BARS` =
20,000 unclamped whenever `from` is falsy, and the default view is 30m with no dates:

```js
const raw = limitForDates(intervalId, fromDate, toDate);
const cap = capBarsFor(intervalId);
// No window selected means "as much as the provider serves", not twenty thousand bars. The payload
// ceiling that goes on the wire is still `raw` — this figure is what the SENTENCE may print.
const wantBars = fromDate ? raw : (cap ?? raw);
const wantBarsIsCeiling = !fromDate;
```

`wantBars` is described in words as a **ceiling**, never as "you asked for N". The `limit` query
parameter on the wire is unchanged (`raw`), because changing it is an engine-visible behaviour change
this tranche has no way to verify. **And nothing anywhere compares a reply's `count` against
`wantBars` to decide whether the provider fell short** — that was finding 1 and it is now forbidden in
writing: see `classifyOutcome` in §3.4.

Example strings this produces (shapes, not copy to be pasted blindly):

- `provider`, 30m, no dates, `windowReachesProvider: false` →
  *"Will ask the provider chain for its fixed 1mo window of 30m bars — about 263 bars at most — and
  store the union with what Rāma already holds. The dates selected above are a display filter and are
  not sent: the provider serves one window per interval. What arrives is reported."*
- `provider`, **1d**, no dates, `windowReachesProvider: false` →
  *"Will ask the provider chain for daily bars — the first fetch reaches back as far as the chain
  allows, later fetches top up the last year — and store the union with what Rāma already holds. There
  is no provider cap on daily bars."* `providerWindow` is `null` here and the phrase **"fixed
  window" is not used**, because for an uncapped interval the depth is `want_years` (30 on an empty
  store, 1 afterwards), not a constant range string.
- `disk` → *"Reads what is already on this machine. No network, no provider call, nothing stored."*
- `older`, 30m, capability granted, window clamped → *"Will ask the provider for 30m bars from
  {from} to {to} and store the union. It reaches back only to {horizon}, because free 30m data is the
  last 21 sessions and not an arbitrary month."*
- `provider`, 1m, 1Y selected → the `beyondCap` case, which the preset's ⚠ already flags
  (`PriceChart.jsx:1800`) and which the contract now also states in words.

**`blocked` is a first-class outcome, and it disables the button *with its reason beside it*** — never
a dead control. Four blocked cases:

| `blocked` reason | When |
| --- | --- |
| *"the window runs backwards — {from} is after {to}"* | `fromDate > toDate` (string compare on `YYYY-MM-DD`) |
| *"the fetch queue is full — it holds 8 provider requests at a time"* | the provider lane is at `MAX_QUEUE` (§3.4) |
| the §3.1 "cannot yet ask for a specific window" sentence | `mode` is `'older'` or `'gap'` and `windowReachesProvider === false` |
| *"nothing is selected"* | no symbol |

`blocked` and `busy` are **two different disable conditions on the same two buttons**, and both are
stated: a button is disabled when `isBusyFor(queue, selection)` (something is in flight for what is on
screen) **or** when its own `contract.blocked` is non-null, and in the second case the reason is
rendered beside it. The rule is the one the ADVANCED card already follows: *a disabled button with no
stated cause is a dead end.*

**Freshness lives here too**, because it is the same question asked after the fact.
`describeFreshness(meta, syncInfo, receivedAt, now)` returns
`{fetchedAt, ageMin, recorded, attributed, text}` following `costs.staleness()`: it reports the age and
names the source of the stamp. **There is no `stale` boolean.** Revision 2 had one with no rule behind
it, in the one function §3.9 names as the owner of *never report stale as fresh*; and §3.9 also
(correctly) forbids the renderer from re-deriving `is_stale`, which left the flag with nowhere to come
from. So the renderer reports **a number and its provenance** and leaves the verdict to the engine:
§3.10 item 7's `staleCheck` is what makes a verdict printable, and only once it exists.

- **`meta.lastFetchedAt` is a naive LOCAL ISO-8601 stamp with no offset and no `Z`** — it is written
  as `datetime.now().isoformat(timespec="seconds")` (`store.merge`'s provenance record), and
  `is_stale`'s cooldown compares it against a local `datetime.now()`. It is therefore **parsed as
  local time** — `new Date('2026-10-02T14:23:11')` — and is **never** suffixed with `Z`, never passed
  through `Date.UTC`, and never "normalised to UTC for safety". Doing so would place every fresh fetch
  5h30m in the future in IST, trip the five-minute future tolerance below, and report every freshly
  fetched series as `recorded: false`. Written down rather than inferred, because master's last three
  reports in this area were timezone-shaped.
- **The stamp is STORE-level, and the wording says so.** `store.merge` writes one `lastFetchedAt` per
  store file, so a range fetched months ago and a range topped up two minutes ago share it. The text
  therefore reads *"the store was last fetched 3h ago"* and **never** *"these bars were fetched…"*.
  §3.12 asserts the string does not attribute a store-level stamp to a range; §3.10 item 5 adds
  per-range `fetchedAt`/`source` so the per-range claim becomes possible; §3.14 records that until
  then freshness is store-level only. *A fetched window must carry when it was fetched* is met as far
  as the payload allows, and the shortfall is named rather than papered over.
- When the stamp is absent or unparseable the result is **`recorded: false`** and the text is *"when
  this was last fetched is not recorded"* — never the renderer's own receipt time dressed as a fetch
  time.
- **Attribution is gated on the engine's own flag, and the provenance field differs by route
  branch.** `syncInfo.fetched` starts `False` in `store.sync`'s `info` and becomes `True` only after a
  real merge, so `attributed = syncInfo?.fetched === true` and only then may the text read *"Yahoo
  answered with 412 new bars"*. Otherwise the same fields are rendered as **provenance** — *"stored
  from Yahoo, the store was last fetched 3h ago"* — and the current job's own time is labelled
  **"read at"**, not "fetched at". `syncInfo.barsAdded` is preferred over `meta.barsAdded` because the
  engine only sets it on a real fetch. And the source name has a **stated precedence**, because
  revision 2 was wrong about which field arrives on which branch — `syncInfo.source` exists only on a
  sync reply (the non-sync branch of the route is the literal `{"fromStore": True}`), while
  `meta.lastSource` is on **every** reply:

  ```js
  // `syncInfo.source` only exists on a sync reply; the store's own provenance is `meta.lastSource`.
  // Neither is THIS job's outcome unless `syncInfo.fetched === true`.
  const source = (syncInfo?.fetched === true ? syncInfo.source : null) ?? meta?.lastSource ?? null;
  ```

  Without that precedence the default view — which is always the non-sync branch — would print *"the
  provider that answered is not recorded"* while the answer sat on the same payload. Reporting the
  last network fetch as this read's outcome is the stale-reported-as-fresh failure in its most literal
  form, which is why both the gate and the precedence are in the one function entitled to compute
  freshness. `<InfoTip id="freshness" />` sits beside this line wherever it renders.

## 3.4 DECISION 4 — The fetch queue: two lanes, eight states, a cancel that does not lie, an explicit retry

New module `src/pages/StockMind/fetchQueue.js` — pure functions over a plain state object, no React,
no timers, no IPC. `StockMind.jsx` holds the state in `useState` and drives it; the module decides
every transition. That split is what makes the queue testable under `node`.

```
state = {
  jobs:  Array<{ key, symbol, exchange, interval, mode, from, to,
                 state, attempt, startedAt, budgetMs, text,
                 count?, matched?, barsAdded?, source?, fetchedAt?, error? }>,
  lanes: { disk: string|null, provider: string|null },   // the key currently holding each lane
}
```

**Job identity, conflict, and currency are three different things.** Revision 2 had the first two and
the review found the hole the third one fills.

1. **The key** is `` `${symbol}|${exchange}|${intervalId}|${mode}|${from}|${to}` ``. Enqueuing a key
   that is already `queued` or `running` is a **reported no-op** (`{accepted: false, reason: 'already
   queued'}`), not a silent drop and not a duplicate.
2. **Conflict** is defined independently of the key, because by the key alone nothing ever conflicts —
   any different interval, mode or date is a different key — and `superseded` would be unreachable:

   ```js
   // Two jobs conflict when they are about the same thing on screen. Disk conflicts only with disk;
   // a provider-class job conflicts with any other provider-class job on the same interval.
   export function conflicts(a, b) {
     if (a.symbol !== b.symbol || a.exchange !== b.exchange) return false;
     if (a.mode === 'disk') return b.mode === 'disk';
     return b.mode !== 'disk' && a.interval === b.interval;
   }
   ```

3. **Currency** is a property of the **page selection**, not of a lane — and this is the fix for the
   hole in revision 2. The per-lane token cannot see an interval change, because the two lanes carry
   independent current keys and that independence is the lane split's whole point. Walk it: a 30m
   provider sync holds the provider lane; master switches to 1m; the filter effect fires
   `loadBars(false)`, which enters the **disk** lane; the provider lane's current key is still the 30m
   job's, so when it answers the lane token accepts it and **30m bars are written while `barInterval`
   is `'1m'`** — fact 24 re-entering through the path revision 2 claimed closed it.

   ```js
   // fetchQueue.js — a reply is written only if it is still ABOUT what is on screen.
   export function isCurrent(job, selection) {
     return job.symbol   === selection.symbol
         && job.exchange === selection.exchange
         && job.interval === selection.interval;
   }

   // StockMind.jsx — one ref, written by the same effect that clears the series (§3.5).
   const selectionRef = useRef({ symbol: sym, exchange, interval: barInterval });
   useEffect(() => { selectionRef.current = { symbol: sym, exchange, interval: barInterval }; },
     [sym, exchange, barInterval]);
   ```

   `settle()` writes bars only when the lane token matches **and** `isCurrent(job, selectionRef.current)`
   holds. And the selection change itself has a **named function**, which revision 2's states table
   promised and never specified:

   ```js
   // Called by the same effect that updates selectionRef. Any job that is no longer about what is on
   // screen goes terminal NOW, so the queue strip stops showing it as live. A RUNNING job keeps its
   // lane reserved until its promise settles (see the cancel rules below) — going terminal is about
   // what master is told, not about pretending the engine stopped.
   export function supersedeStale(state, selection) -> { state, superseded: string[] }
   ```

**Two lanes, because a disk read is not a provider call.** One slot for everything would mean master
cancels a 90-second sync, changes interval three times, and sees nothing load for up to 90 seconds —
the abandoned promise holding the only slot. And eight automatic disk reads would saturate `MAX_QUEUE`
and `block` the fetch button master never filled the queue with.

| Lane | Members | Slots | Queue accounting |
| --- | --- | --- | --- |
| `disk` | `mode: 'disk'` | its own single slot; **never waits** on a provider-class job | not counted against `MAX_QUEUE`; a new disk job **supersedes** any `queued`-or-`running` disk job for the same `(symbol, exchange, interval)`, so disk reads can never accumulate |
| `provider` | `mode` of `'provider'`, `'older'` or `'gap'` | exactly one `running` at a time, FIFO | `MAX_QUEUE = 8`, counting **provider-reaching jobs only**; overflow is reported as a limit (`blocked` in §3.3, `note` from `enqueueAll` in §3.2), never dropped |

One provider job at a time because the providers are free and capped, the engine is one process, and
parallel syncs multiply rate-limit risk for no gain master asked for. Disk reads reach no provider, so
they cost no rate limit and get their own lane. `capacity(state)` returns the free provider slots and
is the one place that arithmetic lives.

**`busy` is derived, once, here** — because it is an existing `PriceChart` prop that drives the loading
overlay (`PriceChart.jsx:2102`), the `disabled` state of both load buttons (`StockMind.jsx:678`,
`:682`) and the popout's refresh control, and three call sites inventing it three ways is how they
disagree:

```js
// The chart is "busy" when something is in flight FOR WHAT IS ON SCREEN. A provider job for another
// interval must not grey out this chart's controls.
export function isBusyFor(state, selection) {
  return state.jobs.some((j) => (j.state === 'queued' || j.state === 'running')
    && isCurrent(j, selection));
}
```

**States.** Two live, six terminal, and the terminal set is where the honesty lives:

| State | Meaning | How it is reached |
| --- | --- | --- |
| `queued` | accepted, nothing in flight | `enqueue()` / `enqueueAll()` |
| `running` | the IPC call is out; carries `startedAt`, `budgetMs`, `attempt` | `start()` — when its lane is free |
| `done` | bars arrived, or a fetch stored bars; carries `count`, `matched`, `barsAdded`, and — **only when `syncInfo.fetched === true`** — `fetchedAt`, `source` | `classifyOutcome()` → `done` |
| **`nothing-read`** | the call **succeeded** and read **nothing** | `classifyOutcome()` → `nothing-read` |
| `limited` | **the engine clamped a windowed request against the interval's cap** | `classifyOutcome()` → `limited`, i.e. `syncInfo.clamped` — **unreachable until §3.10 item 2 lands, and that is correct, not a bug** |
| `failed` | carries `{kind, error, diagnosis, detail, stderrTail}` | `settle()` with `ok: false` |
| `cancelled` | master stopped waiting | `cancel()` |
| `superseded` | a conflicting job replaced it, or the page moved off it | `enqueue()` via `conflicts()`, or `supersedeStale()` via `isCurrent()` |

**`classifyOutcome` has one ordered rule set, and the order is the whole design.** Revision 2 reached
`limited` by `count < wantBars`, which made every store below the cap — every first fetch, and every
thin instrument permanently — read as *"the provider served less than asked"*, and made `done`
unreachable on a capped interval. It also treated `truncated` as a provider shortfall when the route
defines it as `len(bars) < matched`, which is **Rāma's own `limit` trimming the payload**. Both are
fixed by separating the claims:

```js
// fetchQueue.js
// ORDER IS LOAD-BEARING. Each rule is a DIFFERENT CLAIM about what happened, and `wantBars` appears
// nowhere: it is a CEILING by §3.3's own rule, and a count below a ceiling is not a shortfall.
export function classifyOutcome(reply) {   // -> 'done' | 'nothing-read' | 'limited' | 'failed'
  if (!reply || reply.ok === false) return 'failed';
  const d = reply.data || {};
  const s = d.syncInfo || {};
  const count = Number.isFinite(d.count) ? d.count : null;
  if (s.reason === 'store is current')        return 'nothing-read';
  if (s.reason === 'no provider returned data') return 'nothing-read';
  if (s.clamped)                              return 'limited';      // §3.10 item 2; absent today
  // A FETCH THAT STORED BARS IS NOT "NOTHING READ", even when master's date filter matches none of
  // them. The engine reached the provider and merged; the view's emptiness is a statement about the
  // WINDOW, and the route's own `note` makes it ("N bars are stored, but none fall between …").
  if (s.fetched === true)                     return 'done';
  if (count === 0)                            return 'nothing-read';
  return 'done';
}
```

**`truncated` is not a job state at all.** It sets `coverage.leftEdge = 'payload-ceiling'` and prints
E1's sentence — *"the oldest bar shown is the payload ceiling, not the oldest bar stored"* — which is
what §3.11 E1 always said and what §3.4 now agrees with. No precedence ambiguity remains either:
a reply with `count === 0`, no error and a cap in play reaches `nothing-read` through rule 2, 3 or 6,
and never `limited`.

**`nothing-read` is a separate state on purpose.** It is `charge_watch.py`'s distinction — *"Nothing
scanned, so this is 'nothing was read', not 'nothing is changing'"* — applied to the fetch path, and
it is the direct fix for facts 6 and 7, where a 60-minute cooldown and a successful fetch are today
indistinguishable.

**What its sentence may and may not say.** The engine sets **one identical string** for both no-op
cases, `info["reason"] = "store is current"`, and attaches no timestamp, no cooldown and no branch
marker; the two conditions live inside `is_stale` as the two-bar-width freshness slack and the
`max(5, span)`-minute `lastFetchedAt` cooldown. The renderer could only separate them by
re-implementing that arithmetic against a duplicated `INTERVAL_MINUTES` table — a second opinion about
the engine's own staleness rule, which §3.9 forbids, with no drift check of the kind
`verifyTimeframes.mjs` gives the cap table. So:

- `nothing-read` reports **`syncInfo.reason` verbatim**, plus the §3.3 freshness line, plus one
  sentence of ours: *"Rāma reached the engine and the engine did not reach the provider for this
  one."* For `'no provider returned data'` it additionally lists `syncInfo.providersTried`.
- The **cooldown breakdown is deferred to §3.10 item 7** as two new `syncInfo` fields
  (`staleCheck`, `cooldownRemainingMin`). The renderer prints the remaining minutes **only when that
  field is present**, and says nothing about minutes otherwise. No duplicated minutes table, no
  inferred cooldown.

**What a cancel means — stated precisely, because the renderer cannot abort an `invoke`.**

1. The job goes to `cancelled` **immediately** and the UI stops showing it as in flight.
2. Its reply, when it arrives, is **discarded** — neither the bars nor the note are written.
3. The **provider lane** does not start its next job until the abandoned promise settles. Cancel must
   never *increase* engine load. The **disk lane is unaffected** — it was never waiting on that
   promise, which is the whole point of the two lanes.
4. The sentence says exactly that: *"Cancelled — Rāma has stopped waiting for this one. The engine may
   still finish it, and anything it stored will appear on the next read from disk."* Claiming the
   provider call was stopped would be a claim we cannot support.

**And `settle()` therefore does two separable things, which is the fix for the lane lock.** Revision 2
said a cancelled job's reply is discarded *and* that the lane waits for it — with no mechanism, so
nothing observed the settlement and the lane would stay occupied by a terminal job for the rest of the
session:

```js
// Releasing the lane and writing the payload are TWO outcomes of one call. The lane is released
// whatever the job's state — a cancelled or superseded job reserved it, it did not own it forever.
export function settle(state, key, reply, selection) -> { state, wrote: boolean, outcome }
//   1. release whichever lane holds `key`   — ALWAYS, even for a terminal or unknown job
//   2. write the payload and set the terminal state — ONLY when the job exists, is NOT terminal,
//      and isCurrent(job, selection); otherwise the job becomes/stays `superseded` and `wrote` is
//      false, so StockMind never calls setBars for it
//   3. start the next job in each free lane
```

§3.12 asserts both halves: a cancelled running provider job's late reply **releases the lane, writes
no bars, and lets the next queued provider job start**; and a reply for interval A arriving after the
page moved to interval B **never reaches `setBars`**.

**What a retry means.** `retry(state, key)` creates a **new** job with the same key and
`attempt = prev.attempt + 1`, inheriting no state from the failure. There is **no automatic retry in
the renderer.** And one additive bridge change makes that real: `ohlcv()` passes `retries: 0` for
**sync requests only**, so the three silent 90-second attempts of fact 18 become **one visible attempt
per job**. That needs a passthrough `getPath` does not have today — `getPath(path, {timeout = 20000}
= {})` drops any other key on the floor — so §3.5(b) adds one, with the `undefined` branch
byte-identical for every other caller. The capability is not removed: it moves from invisible and
automatic to master's and reported, which is additive in the sense I11 means. Reads keep the default
retry, because a 20-second disk read retrying twice is invisible and harmless.

**Progress.** There is no engine progress endpoint, so there is no progress bar. What is shown is
**elapsed against the budget, labelled as such**: *"48s elapsed of a 90s budget"*, driven by a single
1-second interval that exists only while a job is `running`. A synthetic percentage would be a number
Rāma invented about work it cannot see.

**Not persisted.** The queue lives in renderer memory and is **not** written to `localStorage`. A job
that outlives its renderer cannot be cancelled, cannot be attributed, and cannot have its reply
discarded — so restoring one would restore a ghost. Stated here so a later session does not add
persistence thinking it was an oversight.

## 3.5 DECISION 5 — What master sees when the engine is not running

This is the highest-value decision and the one with the most existing machinery to respect.
`aiProcess.diagnoseFailure` is **total** — every input, silence included, yields a reason and a remedy
with no bare URL or IP — and `scripts/verifyEngineDiagnosis.cjs` holds that down with 34 assertions
(measured green in this worktree this session). `ensureBackendRunning()` already returns
`{ok: false, error, diagnosis, detail, stderrTail}` on its poll-timeout path and
`{ok: false, error, diagnosis, stderrTail}` (**no `detail`**) on its start-failure branch. **None of
that is replaced.** The design routes it to the surface master is actually looking at — and, after the
review, routes it **only where it is right**.

**(a) `electron/lib/http.cjs` — `getJson` keeps the engine's body on a failure.** Today `getJson`
returns `{ error: res.error || 'HTTP ' + status }` and discards `res.body`, which is where FastAPI's
`detail` lives; `postJson` already keeps `status` and `raw` (fact 17). The change is to make `getJson`
match `postJson`: `{ error, status: res.status, raw: res.body?.slice(0, 300) }`. `error` is
byte-for-byte unchanged, so every other caller in the project is unaffected. The invalid-JSON branch
already keeps `raw` and is left alone. **`CIRCUIT_OPEN_MS` is added to `module.exports`** (the value is
unchanged at 20000) so that the one place which names the pause length reads it from the client that
enforces it rather than hard-coding a second copy. Additive, inside the **one** I9 client; no second
client, no new transport.

**(b) `electron/ipc/marketIntel.cjs` — a diagnosed failure object, a scoped diagnosis, and a `retries`
passthrough.** Today a non-gate failure returns `{ok: false, error: 'HTTP 500'}` with no diagnosis and
no stderr, which is facts 17, 19 and 26. Both helpers change the same way:

```js
async function getPath(path, { timeout = 20000, retries } = {}) {
  const gate = await ensureBackendRunning();
  // The gate carries the best diagnosis in the system. It does NOT carry `kind`, and its
  // start-failure branch carries no `detail` — annotate at the boundary so the failure shape is
  // uniform and the best-diagnosed case is never labelled `transport`.
  if (!gate.ok) return { ...gate, kind: 'engine-down', detail: gate.detail ?? null };
  const res = await net.getJson(`${BASE_URL}${path}`,
    retries === undefined ? { timeout } : { timeout, retries });
  return res.error ? await diagnoseTransport(res, timeout) : { ok: true, data: res };
}
```

`postPath` gains the identical gate annotation and the identical `diagnoseTransport` call. The
`retries === undefined` branch keeps every existing caller byte-identical (I11). The failure shape:

```
{ ok: false,
  kind: 'engine-down' | 'engine-error' | 'timeout' | 'circuit' | 'transport',
  error,          // reason + remedy, never a URL, never a bare status
  diagnosis,      // from aiProcess.diagnoseFailure — for 'engine-down' and 'transport' ONLY
  detail,         // optional; the URL, the status, the engine's `detail` from `raw` — demoted
  stderrTail }    // the engine's own last words, read for every kind
```

**`kind` is derived by an ORDERED rule set, and the order is load-bearing.** The circuit-open reply is
`{ok:false, status: 503, error: 'Circuit open for …'}` — a 503 **is** a 5xx, so a status-first rule
would label a 20-second pause as an engine error and show master the wrong remedy. And for a genuine
5xx `request()` returns **no `error` field at all**; the `HTTP 500` string is synthesised inside
`getJson`. So derivation must key on the message first and must never assume `res.error` exists for a
5xx:

```js
function transportKind(res) {
  const msg = String(res?.error || '');
  if (/^Circuit open for /.test(msg))      return 'circuit';
  if (/^Timeout after \d+ms$/.test(msg))   return 'timeout';
  if (/^Invalid JSON/.test(msg))           return 'engine-error';   // it answered, just not in JSON
  // 4xx AS WELL AS 5xx: a 404 from our own route means the engine answered and rejected the path.
  // Calling that `transport` would send it to diagnoseFailure, which would advise a cold-start wait
  // for a live engine that replied in milliseconds.
  if (Number.isFinite(res?.status) && res.status >= 400) return 'engine-error';
  return 'transport';                      // status 0, no status, 'Response too large', a refusal
}
```

**And `diagnoseFailure` is consulted for `engine-down` and `transport` only — this is the review's
third HIGH and it was a real defect.** That function diagnoses *why the engine is not running*; its
branches key on stderr, exit code and `running`. For a live engine that answered HTTP 500 with nothing
on stderr it returns *"the engine process is alive but has not answered on its port yet"* with a
cold-start-wait remedy — verifiably wrong — while FastAPI's own `detail`, the only sentence naming the
real cause, would have been demoted into `detail`. "Never a generic failure" failed in the worse
direction: confidently wrong rather than vague. So the other three kinds get their own sentences:

```js
/**
 * @param {{error?: string, status?: number, raw?: string}} res   a failed getJson/postJson result
 * @param {number} budgetMs the timeout this call was given, so a timeout can name it
 * @returns {Promise<{ok:false, kind, error, diagnosis, detail, stderrTail}>}
 *
 * Lives beside `ensureBackendRunning` in marketIntel.cjs and is exported for
 * scripts/verifyEngineDiagnosis.cjs. Async because stderrTail comes from
 * aiProcess.getRunningStatus(), read with the same `.slice(-4)` the gate uses.
 */
async function diagnoseTransport(res, budgetMs) { … }

function parseDetail(raw) {
  // FastAPI's { "detail": "..." }. A non-JSON body (an HTML error page) yields null and the raw
  // snippet goes to `detail`, never to the headline.
  try {
    const o = JSON.parse(String(raw || ''));
    const d = typeof o?.detail === 'string' ? o.detail.trim() : null;
    return d ? d.slice(0, 300) : null;
  } catch { return null; }
}

function transportReason(res, kind, budgetMs) {     // -> {error, detail} | null
  if (kind === 'engine-error') {
    const detail = parseDetail(res.raw);
    const status = Number.isFinite(res?.status) ? res.status : null;
    return detail
      ? { error: `StockMind's engine answered with an error: ${detail} The ENGINE tab shows its last `
            + `output; nothing was stored for this request.`,
          detail: status ? `HTTP ${status}` : String(res?.error || '') }
      : { error: `StockMind's engine answered${status ? ` with HTTP ${status}` : ''} and no message. `
            + `The ENGINE tab shows its last output; nothing was stored for this request.`,
          detail: [status ? `HTTP ${status}` : null, res?.raw ? String(res.raw).slice(0, 160) : null]
            .filter(Boolean).join(' · ') || null };
  }
  if (kind === 'timeout') {
    return { error: `The engine did not finish this request inside its `
      + `${Math.round((budgetMs || 0) / 1000)}s budget. A provider fetch can outlast it — try again, `
      + `or narrow the window.`, detail: String(res?.error || '') };
  }
  if (kind === 'circuit') {
    return { error: `Rāma has paused calls to the engine for `
      + `${Math.round((net.CIRCUIT_OPEN_MS ?? 20000) / 1000)}s after repeated failures, so this `
      + `request was not sent. Try again after the pause.`, detail: String(res?.error || '') };
  }
  return null;                              // 'transport' falls through to diagnoseFailure
}
```

`stderrTail` is read for **every** kind, because the engine's last words are worth having whatever
answered; only the **headline** is scoped. The URL stays in `detail` — *"a URL tells master where Rāma
knocked; it never tells him why nobody answered"*, Section 106's wording, still the rule. **`detail` is
optional**: when it is absent the detail line is **not rendered at all**, not rendered empty. §3.12
lists which kinds consult `diagnoseFailure` and applies the existing no-URL/no-IP assertion to all
five kinds' `error` strings.

**(c) A read that asks only "why", with no fetch — and the control that calls it.** New
`engineDiagnosis()` in `marketIntel.cjs`, registered as `market:engine-diagnosis` **inside the existing
`readOnly` map** so it inherits the `stockmind.view` gate and cannot bypass `capability.cjs`. It calls
`ensureBackendRunning()` and returns the gate object — `{ok: true}` when the engine answers, the full
diagnosis when it does not — and reaches no provider and spends no engine time. Exposed in
`electron/preload.cjs` as one named method, `marketIntel.engineDiagnosis`. **`ALLOWED_PREFIXES` is
deliberately not touched**: `market:` is not in that list and must not be added — `marketIntel` is an
explicit named-method bridge object, and widening the generic `invokeChannel` surface to every
`market:` channel would be a security change nobody asked for.

**Its trigger is specified, because a channel nothing calls is a placeholder with working plumbing
(I12).** `PriceChart` gains optional `onWhy = null`. When it is supplied **and** the canvas state is
`could-not-ask`, a secondary action appears beside **↻ Try again**: **`why?`**. Pressing it calls
`onWhy()`, which in `StockMind.jsx` invokes `marketIntel.engineDiagnosis({user: currentUser})` and
writes the answer **into the existing `failure` state**, in place, with no new surface:

```js
const askWhy = useCallback(async () => {
  const gate = await window.rama.marketIntel.engineDiagnosis({ user: currentUser });
  setFailure((prev) => (prev ? { ...prev, why: describeDiagnosis(gate, prev.at, Date.now()) } : prev));
}, [currentUser]);
```

`describeDiagnosis(gate, failureAt, now)` is a pure function in `chartEmptyState.js`, so its wording is
asserted rather than typed into JSX:

- `gate.ok === true` → *"The engine is answering now. The failure above was {n} minutes ago, so try
  again."* — honest about what changed, and it does **not** claim the original failure was wrong.
- `gate.ok === false` → `gate.error` (reason **and** remedy) with `gate.stderrTail` under the same
  `<details>` block and `gate.detail` demoted, exactly as the overlay already renders a failure.
- a missing or malformed reply → *"Rāma could not ask its own engine-process manager just now."* and
  nothing invented.

The same `why?` action appears on the amber strip when bars are on screen, because the question is the
same question. The popout and the workspace panel pass `onWhy` too; it costs them one call each.

**(d) `PriceChart` gains optional props, and the canvas states become three.** The full prop contract,
with defaults and call signatures, because "new props" is not a specification:

```
// All optional, all defaulting to the current behaviour (I11).
failure     = null   // §3.5(b) shape + { at: number, why?: string } — this chart's bars failure
queue       = null   // { jobs: Array<{key, mode, state, startedAt, budgetMs, attempt, text}> }
onCancel    = null   // (key: string) => void
onRetry     = null   // (key: string) => void
onLoadOlder = null   // ({ fromDate, toDate }) => void   — the chart computes the window (§3.1)
onFillGap   = null   // ({ windows: Array<{from, to}> }) => void   — from a gap's fromYmd/toYmd
onWhy       = null   // () => void                       — the engine-diagnosis read (§3.5(c))
supports    = null   // the RETAINED capability object; gates ⇠ older, fill, fill all
```

There is **no `contract` prop**: the chart computes `describeRequest()` from props it already holds
(`interval`, `fromDate`, `toDate`, `rangeId`) plus `supports`, which is one call and removes a prop
that could disagree with the chart it describes. `StockMind.jsx` calls the same function for the
sentence beside its own two buttons. `busy` keeps its meaning and its default, and is now **derived**
by `isBusyFor(queue, selection)` at the call sites rather than from a standalone boolean (§3.4).

`queue` is rendered in two places only: the `loading` overlay's elapsed-against-budget line, and a
single-line strip under the chip row listing at most the newest `MAX_SHOWN_JOBS = 3` non-terminal jobs
with their state sentence, a `✕` (calls `onCancel(key)`) while live and a `↻` (calls `onRetry(key)`)
when terminal-and-failed. `<InfoTip id="fetchQueue" />` sits at the head of that strip. With
`queue === null` neither appears, which is what the popout and the board render until they are wired.

New pure module `src/pages/StockMind/chartEmptyState.js`:

```
emptyState({ bars, busy, failure, meta, syncInfo, intervalId, symbol, rangeId, contract })
  -> { state: 'loading' | 'nothing-yet' | 'nothing-upstream' | 'could-not-ask' | 'none',
       headline, remedy, action: 'fetch' | 'retry' | 'none', detail, stderrTail, limitNote }
```

| State | When | What the overlay shows | The button |
| --- | --- | --- | --- |
| `loading` | `busy` | the existing *"Fetching 30m bars for NIFTY50…"* plus the elapsed/budget line | none |
| `nothing-yet` | no bars, no failure, nothing ever stored | the existing sentence, plus the **request contract** (§3.3) | **⇩ Fetch & store them** |
| `nothing-upstream` | no bars, no failure, and `syncInfo.reason === 'no provider returned data'` | the engine's own reason, the `providersTried` list, and `describeLimit(intervalId)` when non-null | **↻ Try again**, worded as a retry of a request that reached the provider |
| `could-not-ask` | `failure` is set | `failure.error` (reason **and** remedy — `diagnoseFailure` and §3.5(b)'s sentences both put both in it), then `<details>engine output</details>` with `stderrTail`, then `detail` dim and last, **and only if present**, then `failure.why` when master has asked | **↻ Try again** and **`why?`** — and **never ⇩ Fetch**, because that is the action that just failed |
| `none` | bars are present | no overlay | — |

**`nothing-upstream` has exactly one trigger today.** Revision 2 listed a second — a frame below the
engine's 20-bar floor — but `providers.fetch_history` returns `(None, "none")` for a short frame and
`store.sync` then sets that *same* `reason` string, so the two are **indistinguishable from the
payload**. The sentence therefore must not claim which of the two happened: it reports the engine's
reason and the providers tried. §3.10 item 4's `shortFrame` field is what separates them, and the
refinement is deferred with it.

This is Phase 2 row 4 — *"three distinct states on the canvas: no data yet, no data upstream,
could-not-ask"* — and it is the answer to fact 23: the diagnosis arrives **on the chart**, in the
overlay master is already looking at, instead of in a card that is above the board in one mode and off
screen in two others.

**Section 107 does not regress.** The canvas stays always-mounted, the overlay stays the same
absolutely-positioned sibling with the same `aria-live="polite"`, the same dashed border and the same
`busy` branch taking precedence (`PriceChart.jsx:2089-2122`). Only the **content of the non-busy
branch** moves behind `emptyState()`. With no `failure` prop and no `syncInfo`, `emptyState()` returns
exactly today's `nothing-yet` text — *"No {label} bars stored for {symbol}{rangeId ? ` over ${rangeId}`
: ''}."* plus the `⇩ Fetch & store them` button plus `limitNote` — so the popout and the workspace
panel, before they are updated, render what they render now. §3.12 asserts that string.

**Who owns a failure — exactly one surface at a time.** Fact 3 is that the empty state is written
twice, in two wordings, in two places, neither aware of the other; adding two more surfaces without
settling ownership would make that worse. And `engineTail`/`engineDetail` are **shared state**:
`runPredict` writes them too (`StockMind.jsx:431-433`) and the `status === 'error'` card renders them
(`:750-767`), so a `failure` derived from them could show a prediction's stderr under the chart. The
rules:

- **`failure` is the only source for the bars path.** It is its own `useState` in `StockMind.jsx`,
  written **solely** by the `ohlcv` settle, and never read by the predict path. It carries
  `at: Date.now()` so `describeDiagnosis` can say how long ago.
- **`loadBars` stops writing `engineTail` / `engineDetail`.** Those stay the predict path's, which is
  what they were for. **No capability is lost**: the same `<details>engine output</details>` block and
  the same demoted `detail` line move onto the canvas overlay and the amber strip, carrying
  `failure.stderrTail` and `failure.detail` — the engine's last words are still one click away, now on
  the surface master is looking at rather than in a card that may be off screen.
- **The canvas owns the failure when `candles.length === 0`; the amber strip above the canvas owns it
  when bars are on screen.** Exactly one renders. Covering real data with an error would be its own
  defect, and the strip carries `failure.error` plus the §3.3 freshness line, because the bars are real
  and the risk is that they are old.
- **The controls-card block at `StockMind.jsx:746-767` renders `barsNote` only.** `barsNote` becomes
  the engine's **own advisory** (`res.data.note` — the truncation and the no-bars-in-window sentences)
  and never a transport failure; and it is suppressed while the canvas is showing a non-`none` empty
  state, because that is the same sentence twice.

**And the stale-bars lie is closed — without resetting master's window.** `loadBars` returns at
`StockMind.jsx:237` before `setBars(...)`, and the clear effect is keyed `[sym, exchange]` only
(`:374-386`), so a failed interval switch leaves 30m candles under a `1m` label with `coverage`
describing the previous interval's store (fact 24 — Section 105's defect re-entering through the error
path). The fix is **two effects, not one widened dependency list**: that effect also calls
`setBarRange(null)`, `setFromDate('')`, `setToDate('')`, and keying *that* on `barInterval` would make
every interval change wipe the window master chose — the exact behaviour Section 110 removed at his
instruction.

```js
// The instrument changed: a window chosen for the last symbol says nothing about this one
// (Section 110). Interval is deliberately NOT in this list.
useEffect(() => {
  setBars([]); setBarsMeta(null); setFailure(null);
  setResult(null); setSelected(null);
  setBarRange(null); setFromDate(''); setToDate('');
}, [sym, exchange]);

// Bars belong to an INTERVAL as much as to a symbol. This clears the series, moves the currency
// marker, and retires any job that is no longer about what is on screen (§3.4). It does NOT touch
// the dates — Section 110 made them independent filters.
useEffect(() => {
  setBars([]); setBarsMeta(null); setFailure(null);
  selectionRef.current = { symbol: sym, exchange, interval: barInterval };
  setQueue((q) => supersedeStale(q, selectionRef.current).state);
}, [sym, exchange, barInterval]);
```

On a `failed` settle, `barsMeta` is cleared while `failure` is set, so `coverage` can never describe
one interval's store under another interval's label.

## 3.6 Threading `coverage` and `failure` through all three call sites

§123.6 decision 8 made this the precondition for coverage shading, and gap 5 of §2.1 names it. Per
call site:

| Call site | Today | After |
| --- | --- | --- |
| `StockMind.jsx:933` CHART tab | `coverage={first,last}` | `coverage` extended with `stored`/`fetchedAt`/`source`/`truncated`, plus `failure`, `queue`, `supports`, `onLoadOlder`, `onFillGap`, `onCancel`, `onRetry`, `onWhy`; `busy={isBusyFor(queue, selection)}` |
| `StockMind.jsx:841` WORKSPACE panel | no `coverage` | the **same** props — it is the same component over the same state, which is the payoff for building it that way |
| `PopoutPanel.jsx:148` popout | no `coverage`, `onFetch={loadBars}` with **no `sync`** | `coverage` from its own reply, `failure` from its own reply, `supports` from its own retained value, and the two call sites wrapped (below) |

**The popout's wrapping is not optional, and getting it wrong inverts the bug.** `Frame` wires
`onClick={onRefresh}` (`PopoutPanel.jsx:41-45`) and `:146` passes `onRefresh={loadBars}`. A React click
handler receives the synthetic event as its first argument, so the moment `loadBars` takes a `doSync`
parameter, `loadBars(SyntheticEvent)` is truthy and the **disk-refresh button issues a 90-second
provider sync**. Both call sites are therefore wrapped explicitly, and §3.12 asserts by source reading
that no bare `onRefresh={loadBars}` or `onFetch={loadBars}` remains:

```jsx
<Frame title={`${title} · ${interval}`} onRefresh={() => loadBars(false)} onDock={dock} busy={busy}>
  …
  <PriceChart … onFetch={() => loadBars(true)} failure={failure}
                coverage={coverage} supports={supports} onWhy={askWhy} />
```

**The popout holds its own `supports`, and starts with the gate closed — stated, not accidental.** It
is a separate renderer with its own session (Section 109, E9), so it holds
`const [supports, setSupports] = useState(null)` and applies `mergeSupports` on every settle exactly as
the main page does. Its only automatic call is a **disk read** (`PopoutPanel.jsx:94-107`, no `sync`),
whose `syncInfo` is `{fromStore: true}` with no `supports` — so by the retention rule a freshly opened
popout shows **no `⇠ older` chip and no `fill` button**, and shows the §3.1 sentence instead, until
master presses ⇩ there. That is the correct behaviour for a window that has not yet heard from the
engine, and it is recorded here as an outcome rather than discovered later as a bug.

The popout also keeps `diagnosis`, `detail` and `stderrTail` off the reply instead of only `res.error`
(fact 25), and it draws `hole` and `beyond-cap` bands but never `asked-absent` — it has no requested
window.

## 3.7 Error handling, operation by operation

| Operation | Failure condition | Recoverable? | What the caller receives | Logged? |
| --- | --- | --- | --- | --- |
| `ohlcv` disk read (`sync: false`) | engine down | yes — retry once it is up | `{ok:false, kind:'engine-down', error, diagnosis, detail, stderrTail}` — the gate's own reason-and-remedy from `diagnoseFailure`, `detail` possibly null; job → `failed`; canvas → `could-not-ask` | nothing in the renderer. The bridge already has the engine's stderr; a `console.error` repeating it adds noise, not information |
| `ohlcv` disk read | engine up, 4xx/5xx | yes | `kind:'engine-error'`, headline built from the engine's own `detail`, status demoted; `diagnoseFailure` **not** consulted | `console.error` in the IPC handler's existing `catch` only |
| `ohlcv` disk read | 2xx with unparseable body | yes | `kind:'engine-error'` (the `Invalid JSON` rule), `raw` demoted into `detail` | no |
| `ohlcv` sync | timeout (90s, one attempt now) | yes, by an explicit retry | `kind:'timeout'`, headline naming the budget in seconds, `res.error` in `detail`; `diagnoseFailure` **not** consulted | no |
| `ohlcv` sync | circuit open | yes, after `CIRCUIT_OPEN_MS` | `kind:'circuit'`, headline naming the pause and its length, the origin string in `detail`; `diagnoseFailure` **not** consulted | no |
| `ohlcv` sync | connection refused, socket error, oversized body | yes | `kind:'transport'`, and **this** is where `diagnoseFailure` is right: there is no body, so the question really is "why is the engine not answering" | no |
| `ohlcv` sync | provider returned nothing | yes | `syncInfo.reason` + `providersTried`; job → `nothing-read`; canvas → `nothing-upstream` | no — this is an outcome, not an error |
| `ohlcv` sync | cooldown / store current | **not a failure** | job → `nothing-read` reporting the engine's reason verbatim plus the freshness line; minutes only if §3.10 item 7 has landed | no |
| `ohlcv` sync | fetched and stored, but master's dates match none of it | **not a failure** | job → `done` with `barsAdded`; the route's own `note` is shown as `barsNote`; canvas → `nothing-yet` with the contract | no |
| `engineDiagnosis` | `aiProcess` cannot be questioned | no, for this call | the gate's last-resort diagnosis, which is already written and tested; `describeDiagnosis` says Rāma could not ask | no |
| `coverageRanges` | mixed time types, junk stamps, unresolved interval, missing `ymd` or `starts` on an intraday chart | yes — degrade to no bands | empty model with `degraded` set; `describeCoverage` says which | no. It runs inside a render and **must never throw** — the rule `chartSessions.js` states |
| `olderWindow` | no bars, unparseable anchor, unresolved interval, window beyond the provider's retention horizon | yes | `{ok:false, reason}`; the chip is not rendered, and for `beyond-retention` `describeLimit` is rendered in its place | no |
| `ChartCoverageLayer.attach` | the library rejects the primitive | yes | `console.warn('[PriceChart] coverage layer unavailable: …')`, layer ref nulled — the existing session-layer pattern verbatim | `console.warn`, once |
| `ChartCoverageLayer.draw` | `timeToCoordinate` → null, sub-pixel band | yes | that band is skipped | no |
| coverage-toggle persistence | storage unavailable | yes | silently ignored, as `PriceChart`'s existing `savePrefs` does | no |

**No `console.log` anywhere** (I12). The renderer modules log nothing at all — a pure function that
logs is a pure function with a side effect — and the bridge keeps `console.error` only in the handler
`catch` blocks that already have it. The one existing `console.warn` pattern
(`PriceChart.jsx:743`, *"session layer unavailable"*) is reused verbatim in shape if the coverage layer
cannot attach: an unshaded chart is still a chart, and the degradation is said out loud. **No
`TODO`/`FIXME` markers**: every unfinished thing in this design is either the engine tranche in §3.10
or a named constant with a stated reason.

## 3.8 Validation of every external input

| Input | Required? | Type / limits | On failure |
| --- | --- | --- | --- |
| `fromDate` / `toDate` from master | optional | `^\d{4}-\d{2}-\d{2}$` — the bridge check in `ohlcv` stays | renderer: `blocked` with *"the window runs backwards"* when `from > to`; bridge: the date is dropped rather than interpolated as garbage (existing behaviour, kept) |
| `limit` on the wire | required | whatever `limitForDates` returns, unchanged — including `MAX_BARS` when no `fromDate` | unchanged. **The contract sentence must not print that number as a request**: it prints `wantBars` (§3.3), which is the cap when no window was selected |
| `barsMeta.stored` / `matched` / `count` / `barsAdded` | optional | `Number.isFinite` | **treated as absent, never as 0.** `Number(null) === 0` is Section 112's lesson; "absent" and "zero bars added" are different sentences |
| `barsMeta.truncated` | optional | boolean | absent → unknown; the left edge is labelled `payload-ceiling` only on an explicit `true`, and **it never affects a job state** (§3.4) |
| `syncInfo.fetched` | optional | strictly `=== true` | anything else → `source`/`barsAdded`/`lastFetchedAt` are rendered as **provenance**, never as this job's outcome |
| `syncInfo.source` | optional (**sync replies only**) | string, trimmed, first 40 chars | falls back to `meta.lastSource` by the §3.3 precedence; only when both are absent does the text say the provider is not recorded |
| `syncInfo.reason` | optional | string, trimmed, first 160 chars, rendered verbatim | absent → no reason sentence; the freshness line still renders |
| `syncInfo.providersTried` | optional | array of strings, first 6, each first 24 chars | non-array → omitted |
| `syncInfo.clamped` | optional (§3.10 item 2) | truthy → `limited`; the clamp name (`'width'`/`'horizon'`/`'both'`) and the cap are printed when present | absent → `limited` is unreachable, by design |
| `syncInfo.supports` | optional | object or absent | **absent → the retained value stands** (§3.2 `mergeSupports`); an explicit object whose `windowedSync` is not strictly `true` closes the gate |
| `syncInfo.cooldownRemainingMin` | optional (§3.10 item 7) | `Number.isFinite`, `0..1440` | absent → no minutes are stated at all |
| `meta.lastFetchedAt` | optional | **naive LOCAL ISO-8601, no offset** (`store.merge`); parsed as local, never suffixed `Z`, never shifted; must not be more than 5 minutes in the future | `recorded: false` → *"when this was last fetched is not recorded"* |
| `stderrTail` | optional | array of strings; bridge already slices to the last 4; renderer caps each line at 400 chars | non-array → `[]`, and the `<details>` block is not rendered |
| `failure.kind` | optional | one of the five literals | unknown → `transport`, the least specific and therefore the safe default. **`engine-down` is set at the gate boundary** (§3.5(b)) so the best-diagnosed case never falls to this default |
| `failure.detail` | optional | string | absent → the detail line is **not rendered**, not rendered empty |
| `candles[].time` | required | number (epoch s, `abs <= 8.64e12`) or `'YYYY-MM-DD'`; one type across the array | mixed or out of range → empty coverage model, no bands |
| `opts.ymd` | optional | `Map` keyed by candle time → `'YYYY-MM-DD'`; non-empty; every value matches the date shape | misshapen or absent → daily falls back to the candle time; intraday returns `degraded: 'no-dates'` |
| `opts.starts` | optional | `Map<'YYYY-MM-DD', number>`, non-empty, every key the date shape and every value a usable time — `injectedStarts`' rule, one bad entry refuses the whole map | misshapen or absent → intraday returns `degraded: 'no-sessions'`; daily never needed it |
| job `key` parts | required | non-empty strings | `enqueue()` returns `{accepted: false, reason}`; nothing is queued |
| `engineDiagnosis` reply | — | `{ok: true}` or the gate shape | anything else → `describeDiagnosis` says Rāma could not ask, and invents nothing |

Everything rendered is **text inside JSX**, so React escapes it; no `dangerouslySetInnerHTML` is
introduced anywhere in this design.

## 3.9 Which layer owns which invariant

| Invariant | Owner | Why there |
| --- | --- | --- |
| Never report stale as fresh | `fetchContract.describeFreshness` | one function computes the age, names the stamp's source, gates attribution on `syncInfo.fetched`, and **makes no staleness verdict** — the verdict is the engine's (`store.is_stale`). Two places computing freshness is how one of them drifts into optimism |
| A store-level stamp is never reported as a range's stamp | `fetchContract.describeFreshness` | it is the only function that renders the stamp, so the *"the store was last fetched …"* wording is enforceable in one place and assertable in one test |
| "Nothing was read" ≠ "nothing happened" | `fetchQueue.classifyOutcome` | it is a **classification of a reply**, not a rendering choice. If the view decided it, three call sites would decide it three ways |
| A reply never outlives what it is about | `fetchQueue.isCurrent` + `settle`'s two halves | the lane token guards duplicates *within* a lane; only a page-selection comparison guards an interval or symbol change *across* lanes |
| A limit is a limit, not a refusal | `timeframes.js` (unchanged) | `describeLimit` / `shortfallNote` already hold the agreed voice and the cap table `verifyTimeframes.mjs` checks against the Python. New text **calls** them |
| The engine's staleness rule | `store.py` (unchanged) | the renderer does not re-derive `is_stale`; it reports the engine's `reason` and waits for §3.10 item 7 for the breakdown. One opinion about staleness, held where the fetch decision is made |
| A capability is the engine's to grant | `fetchContract.mergeSupports` / `supportsWindowedSync` | one strict predicate, one retention rule, one page-level value, asserted in the suite. A JSX condition would be untested and would flicker |
| An affordance may not outrun the engine | `chartCoverage.describeCoverage`'s `actions` | the gate is a **pure-function output**, so "the button is absent and its reason is present" is a tested behaviour rather than a JSX condition |
| One chart, one time type | `chartTime.js` (unchanged) | coverage consumes converted candles, takes dates by injection as a keyed `Map`, and refuses mixed arrays; it is not entitled to a second opinion (Sections 117/118) |
| The zoom policy is applied after data, not fought | `chartZoom.js` + the existing data effect (unchanged) | the coverage layer is draw-only and mutates **no** time scale; the older chip reads `range.from` inside the existing subscription and calls no setter |
| Interval and window are independent filters | the two clear effects in §3.5 | Section 110 was master's instruction; one effect doing both jobs is how it would be undone by accident |
| The right diagnosis for the right failure | `marketIntel.diagnoseTransport` | `diagnoseFailure` answers *"why is the engine not running"*; it is consulted for `engine-down` and `transport` and nowhere else, so a live engine's 500 is never answered with a cold-start remedy |
| Capability gating | `capability.cjs` via the existing `readOnly` map | the new channel is registered in that map, so it cannot acquire a weaker gate by being new. `shared/capabilities.json` is **not** touched — `stockmind.view` already exists and is the right gate for a read |
| One main-process HTTP client | `electron/lib/http.cjs` (I9) | `getJson` is **extended** and one constant is exported, not supplemented. No new client |
| The URL is never the headline | `marketIntel.cjs` `getPath`/`postPath` + `ensureBackendRunning` | all three now build `{kind, error, diagnosis, detail}` the same way, so there is one shape for a failure and `detail` is the only place a connection string can appear |

## 3.10 The engine tranche, specified and deferred

Not attempted here: `ai_backend` cannot be imported on this machine, and §2.1's first gap — *the
requested window must reach the provider* — is engine-side by construction. Specified now so a later
session implements the decision rather than re-taking it:

1. **`GET /ohlcv/{symbol}`** gains `wantFrom`, `wantTo`, `countBack`, `force` query parameters and
   forwards them: `store.sync(sym, exchange, interval, want_from=…, want_to=…, force=force)`.
   `fromDate`/`toDate` keep their current meaning as the **display filter** — the two are separate on
   purpose, so a request window and a view window stay distinguishable. **The bridge's `ohlcv()` gains
   the matching parameters in the SAME tranche**, not this one: this tranche's renderer blocks every
   `older`/`gap` request while `windowReachesProvider` is false, so nothing would populate them, and
   sending unknown query parameters at a FastAPI route whose signature is a fixed parameter list is
   behaviour this environment cannot execute. §3.13's bridge row therefore carries the `retries`
   passthrough **only**.
2. **`store.sync()`** gains `want_from`, `want_to`; passes them to `providers.fetch_history`; and
   reports **`info['clamped']`** when the requested window could not be served as asked, naming
   *which* clamp applied — `'width'` (wider than the interval's cap), `'horizon'` (older than the
   rolling retention window), or `'both'` — together with the cap that applied. That field is the only
   thing that makes `limited` reachable (§3.4), and `limited` is deliberately unreachable until it
   exists. `force` already exists in the signature (`store.sync(symbol, exchange, interval,
   years=None, force=False)`) and is simply never passed by the route today (fact 6) — the route
   starts passing it.
3. **`providers.fetch_history()`** accepts the window and, for the Yahoo intraday path, sends
   `period1`/`period2` instead of the fixed `INTRADAY_RANGE` constant when a window is given —
   **clamped twice, and both clamps are load-bearing**:
   - **width** `<=` the interval's cap in sessions (`PROVIDER_CAP_SESSIONS`), and
   - **position**: `period2` no earlier than `now - cap sessions`, because the provider's intraday
     retention is a *rolling* window and a request for sessions 22–42 of a 21-session interval cannot
     be served however it is phrased.

   `info['clamped']` reports which applied. `timeframes.js`'s duplicated cap table and
   `verifyTimeframes.mjs`'s drift check stay the contract between the two halves.
4. **The 20-bar discard becomes a report** (fact 15, Phase 2 row 5). A 7-bar frame is **stored** and
   returned with `shortFrame: 7`, which is also what finally separates *"the provider had nothing"*
   from *"the provider had too little"* in `nothing-upstream` (§3.5(d)). A newly-listed instrument must
   not look like a dead provider.
5. **`store.merge()`** writes `ranges` — the contiguous spans of the stored frame, **each with its own
   `fetchedAt` and `source`** — into `.meta.json` beside `bars`/`firstBar`/`lastBar`, and
   `meta()`/`inventory()` return it. Two payoffs: `coverageRanges()` can be fed the **store's** record
   (`source: 'store'`) instead of the bars on screen, which is the only way to see a hole outside the
   current payload; and freshness stops being store-level, so *"these bars were fetched …"* becomes a
   sentence Rāma is entitled to say (§3.3).
6. **`syncInfo` advertises its capabilities on BOTH branches of the route.** The non-sync branch builds
   `info` as the literal `{"fromStore": True}`, so attaching `supports` inside `store.sync` alone would
   make every gated affordance appear after a sync and vanish on the next automatic disk read. The
   route attaches it to whatever `info` it holds, on both paths:
   `info = {**info, "supports": {"windowedSync": True, "force": True, "shortFrames": True}}`.
   The renderer's retention rule (§3.2) makes the renderer safe even if an older engine is running;
   this makes the engine correct as well.
7. **`syncInfo` reports WHICH no-op it was.** New fields on the `need is False` branch:
   `staleCheck: 'fresh-bar' | 'cooldown'` and, for the cooldown case, `cooldownRemainingMin: n`
   computed from the same `max(5, span)` and `lastFetchedAt` that `is_stale` already uses. This is what
   lets `nothing-read` name the minutes without the renderer duplicating `INTERVAL_MINUTES`, and what
   makes a staleness *verdict* printable at all (§3.3 drops the renderer's own `stale` flag precisely
   because this does not exist yet).

Until all seven land, the renderer states what it cannot do (§3.1, §3.2), reports the engine's reason
verbatim rather than inferring a cooldown (§3.4), says *"the store was last fetched"* rather than
*"these bars were fetched"* (§3.3), leaves `limited` unreachable (§3.4), and computes coverage from the
bars it holds, labelled `source: 'bars'` and with the left edge labelled `payload-ceiling` whenever
`truncated` is true.

## 3.11 Edge cases

- **E1 — a truncated payload is not the store's edge.** With `truncated: true`, the oldest bar on
  screen is the `limit` ceiling, not the start of the store. No `asked-absent` band is drawn at the
  left edge in that case, and the note says *"the oldest bar shown is the payload ceiling, not the
  oldest bar stored."* Drawing a gap there would invent a hole out of our own pagination. It is **not**
  a job state (§3.4).
- **E2 — NSE holidays.** `HOLIDAY_TOLERANCE_DAYS = 3` business days on daily and coarser, and a band
  that never claims more than *"no bars stored here"*. We have no holiday calendar; this is recorded
  as a heuristic rather than hidden as a fact.
- **E3 — the newest bar is still forming.** The right edge is never a gap. `is_stale`'s two-bar-width
  slack is the engine's version of the same rule; the renderer's version is that `gaps` are only ever
  computed **between** stored bars, never after the last one.
- **E4 — a single bar, or none.** No bands, no chip, no note, no sentence about zero sessions — the
  rule `describeBands` already follows. `olderWindow` returns `{ok:false, reason:'no-bars'}`, so no
  chip and no limit sentence either: nothing is rendered where there is nothing to say.
- **E5 — interval switched mid-flight.** This is the case revision 2 got wrong, so it is written as a
  sequence. A 30m provider sync is `running`. Master picks `1m`. The interval effect clears the series,
  moves `selectionRef` to `1m`, and calls `supersedeStale`, which marks the 30m job `superseded`
  immediately — the queue strip stops showing it as live — while its **lane stays reserved**. The
  filter effect's `loadBars(false)` enters the **disk** lane and loads 1m bars at once. When the 30m
  reply eventually arrives, `settle()` **releases the provider lane**, finds the job terminal and
  `isCurrent(job, selection)` false, **writes nothing**, and starts whatever is next in that lane.
  The canvas shows `loading` and then 1m bars — never 30m candles under a `1m` label (fact 24) — and
  **the date window master chose survives** (§3.5).
- **E6 — symbol switched mid-flight.** The same mechanism; `isCurrent` is false on `symbol`, so the
  reply is discarded and the lane released. `conflicts()` is false across symbols, so the old job is
  not *replaced* — it is *retired*, which is the honest description of what happened.
- **E7 — master cancels a sync and then changes interval three times.** The three disk reads run in
  the disk lane and supersede one another; the chart loads. The abandoned sync still holds the
  provider lane until its promise settles, the queue strip says so, and when it settles the lane is
  released by `settle()`'s first half whatever state the job is in. This is the two-lane rule's reason
  for existing, and the lane release is what keeps it from becoming a permanent lock.
- **E8 — eight automatic disk reads.** They never reach `MAX_QUEUE`, because only provider-reaching
  jobs are counted and because a new disk job supersedes the pending one. Master's fetch button is
  never `blocked` by Rāma's own reads.
- **E9 — two charts, one state.** The CHART tab and the WORKSPACE panel share one queue, one `failure`
  and one `supports`, because they share one `StockMind` component state. A popout has its own, which
  is correct — it is a separate renderer with its own session (Section 109) — and §3.6 states what that
  means on its first paint.
- **E10 — the circuit is open when master presses fetch.** The job fails fast with `kind: 'circuit'`
  (rule 1 of the ordered set, ahead of the status rule, because the reply *is* a 503) and a sentence
  naming the pause and its length, read from the client's own `CIRCUIT_OPEN_MS`. Not a bare origin
  string (fact 19), and **not** a cold-start remedy.
- **E11 — `fetchedAt` in the future.** More than 5 minutes ahead (a clock change) → `recorded: false`
  and the "not recorded" wording. A negative age reported as freshness would be the exact failure
  mode the staleness rule exists to prevent. A **naive** stamp parsed as local must yield a
  non-negative age — §3.12 pins it, because parsing it as UTC in IST is a 5h30m future stamp.
- **E12 — daily and intraday coverage on one chart.** Impossible by the mixed-type refusal: one chart
  holds one interval, and a mixed array yields an empty model.
- **E13 — an older engine with no `supports`.** Every gated control stays absent and the §3.1 sentence
  is shown. Nothing flickers, because absence never revokes and nothing was ever granted.
- **E14 — an engine that grants `supports` and then a disk read that does not mention it.** The
  retained value stands; the controls stay. Because `supports` is one page-level value and not a map,
  it also survives a **symbol switch** — §3.12 asserts exactly these two sequences.
- **E15 — a sync that stored 400 bars none of which fall in master's window.** `syncInfo.fetched` is
  true, `count` is 0, and the job is **`done`, not `nothing-read`** — rule 5 of `classifyOutcome`,
  written for exactly this case. The route's own `note` (*"N bars are stored, but none fall between
  …"*) renders as `barsNote`, the canvas shows `nothing-yet` with the contract, and nothing claims
  either that nothing was read or that bars are on screen.
- **E16 — `fill all` with twelve holes and eight free slots.** `enqueueAll` accepts eight, newest
  first, and returns *"8 of 12 gaps were queued; the fetch queue holds 8 at a time, so press ⇩ fill
  all again when these finish."* Nothing is dropped unreported; nothing is queued past the cap.
- **E17 — `why?` pressed when the engine has come back up.** `engineDiagnosis` returns `{ok: true}`
  and `describeDiagnosis` says the engine is answering **now** and how long ago the failure was. It
  does not retract the failure, and it does not auto-retry: the retry stays master's press.

## 3.12 Testability

**Unit-testable under plain `node`, with no `node_modules`** — the new suite
`scripts/verifyFetchStore.mjs`, wired as `npm run verify:fetch-store` and appended to the `verify`
chain (which today ends `… verifyChartSessions.mjs && auditRenderer.cjs && verifyInvariants.cjs &&
verifyLoyaltyTripwire.cjs`; the new suite goes beside the other chart suites, before
`auditRenderer.cjs`):

- `chartCoverage.coverageRanges` — contiguous intraday runs; a hole inside a session; an overnight
  step that is **not** a hole; a holiday run under tolerance; a single missing bar under
  `MIN_GAP_BARS`; mixed time types → empty with `degraded: 'mixed-times'`; `abs(time) > 8.64e12` →
  empty; an unresolved interval id → empty with `degraded: 'unknown-interval'` **and no throw**;
  intraday with no `opts.ymd` → empty with `degraded: 'no-dates'`; **intraday with no `opts.starts`,
  and with a `starts` map holding one bad key → empty with `degraded: 'no-sessions'`, never a band on
  an overnight step**; daily with no `opts.ymd` → gaps still carry dates; `truncated` → left edge
  `payload-ceiling`; `beyond-cap` boundaries against `PROVIDER_CAP_SESSIONS`; and the property that
  `held` ∪ `gaps` is monotonic, non-overlapping and ascending.
- **The capability gate — the guard this design calls its most important, and therefore the one that
  must not be the only untested thing in it.** `describeRequest({mode:'older', supports: undefined})`
  → `blocked` non-null and `windowReachesProvider === false`;
  `describeRequest({mode:'gap', supports:{windowedSync:'yes'}})` → still `blocked` (strict `=== true`
  only; `1` and `'true'` likewise); `describeCoverage(model, '30m', {supports: null})` → the §3.1
  sentence present and `actions` **empty**; `mergeSupports({windowedSync:true}, undefined)` → the
  granted object survives, and with it `describeCoverage(...).actions.length > 0` — the
  granted-then-silent sequence; `mergeSupports({windowedSync:true}, {windowedSync:false})` → the gate
  closes; and every element of `actions` carries `id`, `label`, `from`, `to`, `windows` and a non-empty
  `title`.
- `fetchContract.describeRequest` — a `disk` request mentions no network; a `provider` request with
  `windowReachesProvider: false` **states** that the dates are not sent; **`wantBars` on the default
  unfiltered 30m view is 263 and the text never contains `20,000`/`20000`**; a `1d` request sets
  `providerWindow: null` and its text contains neither "fixed window" nor an empty "about  bars"; an
  inverted window is `blocked` with a reason; a full provider lane is `blocked` with the queue's
  limit sentence; every `text` is non-empty for every `mode` × every one of the nine intervals; no
  `text` contains a URL or an IP.
- `fetchContract.olderWindow` — `{ok:false}` with the right `reason` for no bars, a junk anchor and an
  unresolved interval; the anchor date is the slice of the oldest raw stamp; `toDate` equals the
  anchor; depth matches `PROVIDER_CAP_SESSIONS` for a capped interval and 252 sessions for `1d`;
  **`reason: 'beyond-retention'` for a 30m store whose oldest bar is 60 sessions old, and
  `ok: true` with `clampedToHorizon: true` when the oldest bar is 10 sessions old**; no horizon clamp
  at all on `1d`; and the **drift assertion** that a today-anchored `olderWindow` agrees date-for-date
  with `datesForRange` for the same session count.
- `fetchContract.describeFreshness` — absent stamp → `recorded: false` and no age claimed;
  unparseable → the same; future stamp beyond 5 minutes → the same; **a naive local stamp of a minute
  ago → `recorded: true` and a non-negative age under 2 minutes** (the IST regression pin); **no
  `stale` key on the returned object** (§3.9's owner makes no verdict); the text contains *"the store
  was last fetched"* and **never** *"these bars were fetched"*; `syncInfo.fetched !== true` →
  `attributed: false` and the text says "read at" and "stored from", never "answered with";
  `syncInfo.fetched === true` → `attributed: true` and `syncInfo.barsAdded` preferred over
  `meta.barsAdded`; and the **source precedence**: `{fetched:false, source:'Yahoo'}` with
  `meta.lastSource = 'Stooq'` renders `Stooq` as provenance, while a reply with neither says the
  provider is not recorded.
- `fetchQueue` — the full state machine: duplicate keys reported not dropped; one `running`
  provider job at a time; a disk job starting while a provider job runs; a new disk job superseding a
  pending disk job for the same triple; `conflicts()` true for two provider-class jobs on one
  interval and false across intervals and symbols; `isCurrent()` false on each of symbol, exchange
  and interval; `supersedeStale()` marking a running non-current job terminal **without** releasing
  its lane; **a cancelled running provider job's late reply releasing the lane, writing no bars
  (`wrote === false`) and letting the next queued provider job start**; **a provider reply for
  interval A after the selection moved to interval B returning `wrote === false`**; `retry`
  incrementing `attempt` and inheriting nothing; `MAX_QUEUE` counting provider jobs only;
  `enqueueAll` with 12 windows and 8 free slots accepting 8, reporting 4 and dropping none;
  `isBusyFor` true for a queued job on the current selection and **false** for a running job on
  another interval; and the property that every terminal state carries a sentence.
- **`classifyOutcome`, rule by rule, because the ordering *is* the honesty** — `reason: 'store is
  current'` → `nothing-read`, never `done`; `'no provider returned data'` → `nothing-read` with
  `providersTried` carried; `{fetched:true, barsAdded:400, count:0}` → **`done`** (E15);
  `{fetched:false, count:0}` → `nothing-read`; `{truncated:true, count:240, matched:900}` → **`done`**
  and `limited` **never** reached; `{clamped:'horizon'}` → `limited`; `{ok:false}` → `failed`; and a
  property test that **no reply without `clamped` ever yields `limited`**, which is the regression pin
  on finding 1.
- `chartEmptyState.emptyState` — the five states are mutually exclusive; a `failure` **never** yields
  `action: 'fetch'`; `nothing-upstream` carries the engine's own reason and does **not** claim whether
  the provider had nothing or too little; `could-not-ask` omits the detail line entirely when
  `failure.detail` is null; and with no `failure` and no `syncInfo` the output is today's
  `nothing-yet` text (the no-regression assertion for Section 107).
- `chartEmptyState.describeDiagnosis` — `{ok:true}` → the "answering now" sentence with the elapsed
  minutes and **no** claim that the earlier failure was wrong; `{ok:false, …}` → the gate's own
  `error` verbatim as the headline; `null`/garbage → the "could not ask" sentence and nothing
  invented; no output contains a URL or an IP.

**Extended in `scripts/verifyEngineDiagnosis.cjs`** — partly by `require`, partly by the same
source-reading technique that file already uses for the Section 106 gate, so the plumbing cannot
silently regress. `marketIntel.cjs` is requireable under plain `node` once `aiProcess.cjs` is in the
require cache (its only other module-scope dependencies are `lib/http.cjs` and `lib/capability.cjs`,
which need nothing but `fs` and a JSON file), so **the existing `electron` stub stays installed until
after both requires** rather than being restored immediately:

- `diagnoseTransport` is exported, and for each kind: `'Circuit open for http://127.0.0.1:8001'` →
  `kind: 'circuit'` with the pause length in `error` and the origin only in `detail`;
  `'Timeout after 90000ms'` → `kind: 'timeout'` naming the budget; `{status: 500, raw: '{"detail":
  "no provider returned data"}'}` → `kind: 'engine-error'` whose `error` **contains the engine's
  detail** and whose `detail` is `HTTP 500`; `{status: 404}` → `engine-error`; `{status: 0, error:
  'connect ECONNREFUSED'}` → `kind: 'transport'` **and** a `diagnosis` object present.
- **`error` contains no URL and no IP for all five kinds** — the assertion this file already makes of
  `diagnoseFailure`, extended to the new strings.
- `diagnoseFailure` is **not** consulted for `circuit`, `timeout` or `engine-error`: asserted by
  source reading, that `transportReason` returns before any `diagnoseFailure` call for those kinds.
- `http.cjs`'s `getJson` keeps `status` and `raw` on a failure (and `postJson` still does), and
  `CIRCUIT_OPEN_MS` is exported.
- `marketIntel.cjs`'s `getPath` and `postPath` both annotate the gate object with
  `kind: 'engine-down'` and `detail: gate.detail ?? null`, and both call `diagnoseTransport` on a
  non-gate failure.
- `getPath` forwards `retries` only when defined (the `retries === undefined` branch is present).
- `transportKind` tests the circuit message **before** any status comparison.
- `market:engine-diagnosis` is registered **inside** the `readOnly` map (so it carries the
  `stockmind.view` gate), and `engineDiagnosis` is exported.
- `ALLOWED_PREFIXES` in `preload.cjs` still does **not** contain `market:`.
- `PopoutPanel.jsx` contains no bare `onRefresh={loadBars}` and no bare `onFetch={loadBars}`.
- `PriceChart.jsx` renders no `⇠ older` / `fill` control outside a `supportsWindowedSync` guard, and
  contains no `setVisibleRange` / `setVisibleLogicalRange` call inside the older-chip path.
- `StockMind.jsx`'s `loadBars` no longer calls `setEngineTail` / `setEngineDetail` (ownership,
  §3.5); the `[sym, exchange, barInterval]` effect contains no `setFromDate` / `setToDate` /
  `setBarRange` (Section 110); and `supports` is held as a single `useState`, not a keyed map.

**`verifyGlossary.mjs` must stay green, and that constrains the four new terms.** Each of
`coverageGap`, `requestContract`, `fetchQueue` and `freshness` needs a unique display name, a declared
group (`chart` for the first three, `instrument` for `freshness` — both groups exist), a `short` of at
most 130 characters ending in a full stop, a `long` that is longer than its own `short`, under 700
characters, and with at least eight substantive words beyond the term's own name — and **a render
site**, because the suite fails on a defined-but-unreferenced term as well as on a referenced-but
-undefined one. The render sites are named in §3.13 and all four are real `InfoTip`s, so none of them
relies on a `seeAlso` to be reachable.

**Integration-testable only, and stated as such**: that the overlay actually paints, that the hatch is
legible, that `timeToCoordinate` places a band where master expects, that a 90-second sync's cancel
feels right, and every one of the §3.10 engine behaviours. None of it can be exercised here. **`vite
build` cannot be run in this worktree** — `node_modules` is installed in the main workspace only — so
no claim will be made that the renderer builds; the bar for this tranche is `node --check` on every
`.cjs` touched, clean diagnostics on every `.jsx` touched, the new `.mjs` suite, the extended
`verifyEngineDiagnosis.cjs`, plus `auditRenderer.cjs`, `verifyGlossary.mjs`, `verifyTimeframes.mjs`,
`verifyChartTime.mjs`, `verifyChartSessions.mjs` and `verifyInvariants.cjs`.

## 3.13 Files the implementation will touch

**New (6).**

| File | What |
| --- | --- |
| `src/pages/StockMind/chartCoverage.js` | `coverageRanges` + `describeCoverage` — pure, no React, no charting library |
| `src/pages/StockMind/ChartCoverageLayer.js` | the third series primitive; x-only, `zOrder: 'bottom'` |
| `src/pages/StockMind/fetchContract.js` | `describeRequest`, `describeFreshness`, `olderWindow`, `ymdMinusSessions`, `mergeSupports`, `supportsWindowedSync` |
| `src/pages/StockMind/fetchQueue.js` | the two-lane state machine: `enqueue`, `enqueueAll`, `start`, `settle`, `cancel`, `retry`, `supersedeStale`, `conflicts`, `isCurrent`, `isBusyFor`, `capacity`, `classifyOutcome` |
| `src/pages/StockMind/chartEmptyState.js` | `emptyState` + `describeDiagnosis` — which of the three nothings, and the failure and "why" text |
| `scripts/verifyFetchStore.mjs` | the suite for the four pure modules |

**Modified (11).**

| File | Change |
| --- | --- |
| `src/pages/StockMind/PriceChart.jsx` | new **optional** props `failure`, `queue`, `supports`, `onLoadOlder`, `onFillGap`, `onCancel`, `onRetry`, `onWhy` with the §3.5(d) shapes; `coverage` extended as a superset; the coverage model, the `ymd` map and the request contract computed internally; the coverage layer attached beside the session layer; the `nearLeftEdge` test added **above** the existing px-per-bar dedupe in the one visible-range subscription; the store-measured, null-guarded `atCap`; the overlay's non-busy branch delegated to `emptyState()`; the `why?` secondary action; the amber strip for a failure with bars on screen; the `coverage (n)` chip with `InfoTip id="coverageGap"`; the queue strip with `InfoTip id="fetchQueue"`; the coverage note, the freshness line with `InfoTip id="freshness"`, and the `aria` text |
| `src/pages/StockMind/StockMind.jsx` | the queue replaces `barsBusy` (`busy` now `isBusyFor(queue, selection)`); `loadBars` becomes an enqueue, settles through `settle(…, selectionRef.current)` and stops writing `engineTail`/`engineDetail`; new `failure` state carrying `at`; one page-level `supports` with `mergeSupports`; `selectionRef`; **two** clear effects (`[sym, exchange]` keeps the window reset, `[sym, exchange, barInterval]` clears the series, moves `selectionRef` and calls `supersedeStale`); `askWhy`; `barsNote` reduced to the engine's advisory and suppressed while the canvas states it; all new props passed to **both** call sites; the contract line with `InfoTip id="requestContract"` beside the two load buttons |
| `src/pages/StockMind/PopoutPanel.jsx` | `loadBars(doSync)`; **`onRefresh={() => loadBars(false)}`** and **`onFetch={() => loadBars(true)}`**; keeps `diagnosis`/`detail`/`stderrTail` as its own `failure`; its own `supports` with `mergeSupports`; passes `coverage`, `failure`, `supports`, `onWhy` |
| `src/pages/StockMind/glossary.js` | four entries, each with a named render site: `coverageGap` (beside the `coverage (n)` chip), `requestContract` (beside the contract line on the controls card), `fetchQueue` (at the head of the queue strip), `freshness` (beside the provenance/amber line) — all four as real `InfoTip`s, so `verifyGlossary.mjs`'s orphan check passes without leaning on `seeAlso` |
| `electron/lib/http.cjs` | `getJson` keeps `status` and `raw` on a failure, matching `postJson`; `CIRCUIT_OPEN_MS` added to `module.exports`. One client, extended |
| `electron/ipc/marketIntel.cjs` | `getPath`/`postPath` annotate the gate with `kind: 'engine-down'` and `detail ?? null`; new exported `diagnoseTransport` / `transportKind` / `transportReason` / `parseDetail` with the ordered rule set and the per-kind sentences; `getPath` gains a `retries` passthrough forwarded only when defined; `ohlcv` passes `retries: 0` for sync (**and no window parameters — those land with §3.10 item 1**); new `engineDiagnosis()` registered in the existing `readOnly` map |
| `electron/preload.cjs` | one named method, `marketIntel.engineDiagnosis`. `ALLOWED_PREFIXES` untouched |
| `scripts/verifyEngineDiagnosis.cjs` | the `diagnoseTransport` assertions and the source-reading assertions in §3.12; the `electron` stub held until after the `marketIntel.cjs` require |
| `package.json` | `verify:fetch-store`, and appended to the `verify` chain. No dependency added |
| `RAMA_AGI_MASTER_SPEC.md` | **Section 129** recording these five decisions, and **ledger row 149** per the resume protocol. *Numbers corrected from the 126/146 this table originally named: both were taken on `dev` while the narrowed tranche was in review. The blocks are at the end of this document, ready to paste; the branch itself does not edit the spec* |
| `docs/research/FETCH_AND_STORE.md` | this Phase 3 section |

**Explicitly not touched.** `chartTime.js`, `chartZoom.js`, `timeframes.js`, `chartSessions.js`,
`ChartSessionLayer.js`, `ChartDrawingLayer.js`, `electron/lib/loyaltyGuard.cjs`, `loyaltyCore.cjs`,
`nucleusSealer.cjs`, `proposals.cjs`, `capability.cjs`, `genomeApplier.cjs`,
`shared/capabilities.json`, and every file under `ai_backend/` — the last of those being §3.10's
tranche, not this one's.

## 3.14 Phase 3 — NOT VERIFIED

- **Nothing in this design has been implemented or run.** It is a plan read against source. Every
  code claim in revision 3 was re-read in this worktree at HEAD `9669eea`.
- **Whether the providers' intraday retention is a ROLLING window or merely a maximum width is read
  off the request shape, not observed.** `providers.py` sends `range=1mo` for 30m, which reads as "the
  last month"; `timeframes.js` records 21 sessions. §3.1 and §3.10 item 3 both assume rolling and
  therefore clamp **position** as well as width. If the provider in fact serves an arbitrary month
  within a longer archive, the horizon clamp is too strict and `⇠ older` will refuse windows that
  would have worked — a conservative error, and the one worth making, but it is an assumption and not
  a measurement. It can only be settled by watching a real `period1`/`period2` request, which this
  environment cannot do.
- **Whether `/ohlcv` tolerates unknown query parameters is unknown**, which is exactly why this
  tranche does **not** add `wantFrom`/`wantTo`/`countBack`/`force` to the bridge's `ohlcv()`; they land
  with the route change that consumes them (§3.10 item 1).
- **Freshness is store-level only.** `meta.lastFetchedAt` is one stamp per store file, so the design's
  wording is *"the store was last fetched"* and the per-range claim waits for §3.10 item 5's
  `ranges[].fetchedAt`. The step's *"a fetched window must carry when it was fetched"* is therefore met
  as far as the payload allows, with the shortfall named rather than approximated silently.
- **The gap heuristics are unmeasured.** `GAP_FACTOR = 1.5`, `MIN_GAP_BARS = 2`,
  `HOLIDAY_TOLERANCE_DAYS = 3`, `OLDER_PROMPT_BARS = 20`, `MAX_LISTED_GAPS = 3` and
  `MAX_SHOWN_JOBS = 3` are reasoned starting values, not tuned ones. They cannot be tuned without a
  real store, and the store needs the engine. The suite will pin the **behaviour at each threshold**;
  the thresholds themselves stay open and are named here so a later session adjusts them deliberately.
- **The `olderWindow` session→calendar-day arithmetic is duplicated from `datesForRange`** and is made
  safe by a drift assertion rather than by sharing code, because `timeframes.js` is on the
  do-not-touch list for this tranche. If a later tranche is allowed to touch it, exporting the
  conversion and deleting the copy is the better end state.
- **The `injectedStarts` refusal rule is duplicated** from `chartSessions.js` for the same reason — it
  is module-private there and that file is not to be touched. §3.12 asserts the two agree; if they
  drift, the assertion is what catches it.
- **Fact 24 is still unobserved** (Phase 1 flagged it as the claim most worth seeing on a screen).
  §3.5's fix is safe regardless of whether the symptom has been seen, because showing one interval's
  candles under another's label is wrong either way.
- **The circuit-breaker and mid-fetch-death paths (facts 19, 26) remain inferred from constants and
  control flow.** The design now routes them through their own sentences rather than through
  `diagnoseFailure`; whether master has ever been shown `Circuit open for http://127.0.0.1:8001` is
  still unknown.
- **`marketIntel.cjs` has never been `require`d under plain `node` in this worktree.** §3.12's new
  assertions depend on it loading with the existing `electron` stub in place; that is read off its
  module-scope requires (`lib/http.cjs`, `lib/capability.cjs`, `./aiProcess.cjs`), not executed. If it
  does not load, the fallback is the source-reading technique the file already uses for every other
  assertion, and the per-kind sentences are asserted by regex instead.
- **`verifyEngineDiagnosis.cjs` → 34 passed / 0 failed** is carried from this session's measurement;
  the review did not re-run it and neither did this revision.
- **No claim is made that the renderer builds.** `vite build` cannot run in this worktree.
- **The §3.10 engine specification has not been checked against a running engine** and will need
  re-reading against `providers.py` before it is implemented — in particular whether Yahoo's
  `period1`/`period2` is accepted alongside each intraday `interval`. Item 7's `cooldownRemainingMin`
  is likewise specified from reading `is_stale`, not from watching it run.
- **One pre-existing engine defect, recorded and not touched** (carried forward): `dispatcher.LOT_SIZES`
  says `NIFTY: 25` while `strategy_spec.py` says 75. Unrelated to fetch-and-store, still out of scope.

## 3.15 Responses to the design review

`docs/research/design-review.json` — revision 2, verdict `CHANGES_REQUESTED`, **4 HIGH / 14 MEDIUM /
3 NIT**. Every HIGH and MEDIUM is **addressed**; nothing is backlogged and nothing is dismissed. The
three NITs are addressed too, because each was a factual error in prose that a later reader would have
inherited as fact. (Revision 1's review — 5 HIGH / 15 MEDIUM / 3 NIT — was answered in revision 2;
where this round found that an answer was itself wrong, the correction is noted below rather than the
earlier claim being quietly dropped.)

| # | Sev | Finding | Response |
| --- | --- | --- | --- |
| 1 | HIGH | `limited` by `count < wantBars` labels every under-cap store a shortfall; `truncated` is Rāma's own `limit`, not the provider's; no precedence for `count === 0` | **Addressed** — §3.4 replaces the state's definition with an **ordered `classifyOutcome(reply)`**: `failed` → the two `reason` strings → `clamped` → `fetched === true` → `count === 0` → `done`. `wantBars` appears nowhere in it and §3.3 says so in writing. `truncated` leaves the state machine entirely and becomes `coverage.leftEdge = 'payload-ceiling'` with E1's sentence. `limited` is stated to be **unreachable until §3.10 item 2** lands, and §3.12 adds a property test that no reply without `clamped` ever yields it. One addition to the reviewer's rule set: a reply with `fetched === true` is `done` even when `count === 0`, because a fetch that stored 400 bars outside master's window must not be reported as *"nothing was read"* — the inverse of the same lie (E15) |
| 2 | HIGH | The in-flight token is per-lane, so a provider reply for the previous interval still lands | **Addressed** — §3.4 adds `isCurrent(job, selection)` and a `selectionRef` written by the same effect that clears the series; `settle()` writes only when the lane token matches **and** `isCurrent` holds. The supersede trigger the states table promised now has a named function, `supersedeStale(state, selection)`, called by that effect. E5 is rewritten as a six-step sequence against that mechanism, and §3.12 asserts `wrote === false` for a reply whose interval has moved |
| 3 | HIGH | `diagnoseFailure` is made the headline for `engine-error`/`timeout`/`circuit`, where it is confidently wrong | **Addressed** — §3.5(b) scopes it to `engine-down` and `transport` and adds `transportKind` / `transportReason` / `parseDetail` with a written sentence per kind: the engine's own `detail` becomes the headline for a 4xx/5xx with the status demoted, the timeout names its budget, the circuit names its pause from the client's own exported `CIRCUIT_OPEN_MS`. 4xx joins 5xx in `engine-error`, because a 404 is also an answer. `stderrTail` is still read for every kind, so no capability is lost. §3.7 and §3.9 record which kinds consult `diagnoseFailure`, and §3.12 applies the no-URL/no-IP assertion to all five |
| 4 | HIGH | `⇠ older` can never be served on a capped intraday interval; §3.10 item 3's clamp is ambiguous between width and position | **Addressed** — `olderWindow` returns a **discriminated result**, with `reason: 'beyond-retention'` when the computed window ends before `now - cap sessions` and `clampedToHorizon` when only its start did; the chip is replaced by `describeLimit` in the first case and the contract sentence names the horizon in the second. §3.10 item 3 now states **both** clamps (width ≤ the cap, `period2` ≥ `now - cap sessions`) with `info['clamped']` naming which applied. §3.12 asserts the 60-sessions-old and 10-sessions-old cases, and §3.14 records the rolling-vs-width question as the assumption it is |
| 5 | MED | `atCap` measured off the date-filtered payload | **Addressed** — §3.1 prefers `coverage.stored`, falls back to `candles.length` only when the store is not described, and §3.2 adds optional `stored?: number` to the superset |
| 6 | MED | `syncInfo.source` does not exist on a disk read; `meta.lastSource` does | **Addressed** — §3.3 states the precedence as code, corrects its claim about which fields arrive on which branch, and §3.8's row and §3.12's assertion both follow it |
| 7 | MED | `busy` is undefined once the queue replaces `barsBusy` | **Addressed** — `isBusyFor(state, selection)` is defined in `fetchQueue.js` (§3.4) and used at all three call sites; §3.3 states that `blocked` is a *second*, separate disable condition and tabulates its four reasons |
| 8 | MED | `diagnoseTransport` called but never defined | **Addressed** — §3.5(b) gives it a JSDoc signature, says it is `async` and why, places it beside `ensureBackendRunning` in `marketIntel.cjs`, exports it for the suite, and specifies the `.slice(-4)` stderr read |
| 9 | MED | `opts.starts` relied on but unspecified; absent would make every overnight step a hole | **Addressed** — §3.2 tabulates both injected inputs with the `injectedStarts` shape rule, adds `degraded: 'no-sessions'`, and states the refusal outright. §3.12 asserts the one-bad-key case and that no band is ever drawn on an overnight step |
| 10 | MED | `actions[]` has no element shape; `fill all` has no interaction with `MAX_QUEUE` | **Addressed** — §3.2 defines the element shape including `windows` and the per-window `title`, and gives the overflow to `fetchQueue.enqueueAll`, which accepts up to free capacity and returns the limit sentence. E16 and §3.12 pin the 12-against-8 case |
| 11 | MED | Nothing releases the provider lane when its running job is cancelled | **Addressed** — §3.4 splits `settle()` into *release the lane* (always) and *write the payload* (only for a non-terminal, current job), with the three steps written out; E7 and §3.12 assert the lane is freed and the next job starts |
| 12 | MED | `supportsRef` keyed per instrument contradicts its own rationale | **Addressed** — §3.2 holds **one page-level `supports`** value; `MAX_SUPPORTS_KEYS` and the eviction prose are gone; E14 now also covers a symbol switch, and §3.12 asserts `supports` is a single `useState` in source |
| 13 | MED | `market:engine-diagnosis` has no call site — a placeholder with working plumbing | **Addressed** — §3.5(c) specifies the trigger (`why?` beside **↻ Try again** on the `could-not-ask` overlay and on the amber strip), the prop (`onWhy`), the handler (`askWhy`), the state it writes (`failure.why`, in place) and the pure function that words it (`describeDiagnosis`), which §3.12 asserts in three cases |
| 14 | MED | Four new glossary terms, one render site; `verifyGlossary.mjs` fails on an orphan | **Addressed** — §3.13 names a render site for each of the four, all real `InfoTip`s, and §3.12 writes out the suite's shape rules (unique name, declared group, `short` ≤ 130 ending in a full stop, `long` longer and ≤ 700, ≥ 8 substantive words) so the entries are written to pass rather than fixed afterwards |
| 15 | MED | `stale` is in the returned shape with no rule | **Addressed, the recommended option taken** — the boolean is **dropped**. `describeFreshness` returns `{fetchedAt, ageMin, recorded, attributed, text}`: a number and its provenance, with the verdict left to `store.is_stale` and made printable only by §3.10 item 7. §3.9's owner row says so and §3.12 asserts the key's absence |
| 16 | MED | One store-level `fetchedAt` presented beside a per-range model | **Addressed, both parts** — the wording becomes *"the store was last fetched …"*, asserted in §3.12; §3.10 item 5 adds per-range `fetchedAt` and `source`; §3.14 records that freshness is store-level until then |
| 17 | MED | §3.13 and §3.10 disagree about the window parameters | **Addressed, the lower-risk answer taken** — the clause is removed from §3.13's bridge row (leaving only the `retries` passthrough) and moved into §3.10 item 1 beside the route change that consumes it; §3.14 records the unknown-parameter tolerance as the reason |
| 18 | MED | The popout's `supports` has no source or retention | **Addressed** — §3.6 states that the popout holds its own `useState(null)` and applies `mergeSupports` on every settle, and that a fresh popout therefore starts with the gate **closed** and the §3.1 sentence shown. Related simplification: the `contract` prop is removed altogether — the chart computes its own request contract from props it already holds, which is one fewer thing for a third renderer to source and one fewer prop that can disagree with the chart it describes |
| 19 | NIT | "React 18" | **Addressed** — §3.0 locks **React 19** function components with hooks, and names the `19.2.0` pin |
| 20 | NIT | `opts.ymd` is not the same injection style as `sessionBands`' `starts` | **Addressed, and it was worse than a wording slip** — `candles` is built from `bars` by a map that drops unusable bars and de-duplicates equal times, so a parallel array would be **silently misaligned** as soon as one bar is dropped. §3.2 makes `opts.ymd` a `Map` keyed by candle time, built inside the same `useMemo` that builds `candles`, and reuses the refusal pattern for both injected maps |
| 21 | NIT | `nothing-upstream`'s second trigger is not separately detectable | **Addressed** — §3.5(d) states one trigger, says the 20-bar floor is indistinguishable from it on today's payload, and forbids the sentence from claiming which happened until §3.10 item 4's `shortFrame` lands |

**What the review got right that is worth carrying forward.** Its 38-item "Verified assumptions" list
was re-checked rather than trusted. All 38 hold at HEAD `9669eea`, with two refinements worth
recording: `getJson`'s failure branch returns **no `status`** today (so the `kind` rules must key on
the message first, which the design already did for a different reason), and `CIRCUIT_OPEN_MS` is
**not** currently exported from `http.cjs`, which is why §3.5(a) adds it to `module.exports` rather
than assuming it available. Its four "unverified and NOT flagged" items are findings 4, 16 and 17
above plus the un-re-run suite, and all four are now either resolved in the design or recorded in
§3.14.



## DEFERRED BY THE ORCHESTRATOR

This design went through three review rounds (5 HIGH, then 4 HIGH, then 6 HIGH) without converging,
because it had grown past a thousand lines covering six subsystems at once. The reviewer was right
each time; the tranche was simply too large. The orchestrator therefore cut the scope, and **only
three items were built** on `chart/fetch-and-store`:

1. the missing props threaded to all three `PriceChart` call sites (§3.5(d)'s prop contract, reduced
   to `coverage` + `replyNote` + `failure`);
2. the false `nothing-yet` headline replaced by a `nothing-in-window` state whose sentence is the
   route's own (HIGH 4);
3. the engine-down diagnosis routed to all three charts and all failure modes.

What was built is recorded in `docs/research/build-verification.md` and asserted by
`scripts/verifyChartEmptyState.mjs`.

**The document below is left intact as the record for the next tranche.** Everything in the table
that follows is still designed, still unbuilt, and **still carries an unresolved HIGH finding**. Each
row names the findings in `docs/research/design-review.json` that must be resolved in the design
*before* any of it is implemented.

| Deferred item | Sections | Unresolved HIGH findings that gate it |
| --- | --- | --- |
| **The fetch queue, in every form** — `fetchQueue.js`, the lanes, the job keys, `enqueue`/`settle`/`cancel`/`retry`/`supersede`, and the eight-state table | §3.4, §3.2 `enqueueAll`, §3.13, E7, E16 | **HIGH 1** the dispatcher is unspecified (both `start()` and `settle()` move a job to `running`, neither performs IPC, so every job after the first of a lane would be marked running and never sent; the obvious `useEffect` has a double-dispatch hazard under React 19 StrictMode). **HIGH 2** `conflicts()` treats two `gap` jobs on different windows as conflicting, so `enqueueAll` collapses 12 windows into 1, making `MAX_QUEUE = 8` unreachable and E16 impossible. **HIGH 3** key ambiguity on cancel-then-retry |
| **Gap kinds and the fill affordance** — the `hole` / `asked-absent` / `beyond-cap` taxonomy, the third series primitive, the fill buttons | §3.2 `describeCoverage`, §3.1's retention clamp, §3.10, E16 | **HIGH 6**, both parts: the retention clamp is applied in `olderWindow` only and not to fill, so a fill button would appear for holes that are unservable by construction — on capped intraday intervals, the only class where holes form, recreating the un-followable remedy the design calls its most important guard; and `hole` and `beyond-cap` overlap with no precedence rule and no stated anchor for "older than N sessions" |
| **Lazy paging and the older-history prompt** | §3.1, §3.10 | **HIGH 2** (a full-interval sync is silently retired the moment master presses ⇠ older, which is the same `conflicts()` defect) and **HIGH 6** (the retention clamp that bounds ⇠ older is the clamp fill ignores) |
| **`describeRequest()` and the request-contract strip** | §3.5, §3.6, §3.13 | **HIGH 5** — `emptyState` was specified to require `meta` and `syncInfo`, which `PriceChart` is never given, so `nothing-upstream` was unreachable and `describeFreshness` could not be called with its specified signature. The narrowed build did **not** add those two props: the route sends both fields, but nothing in the renderer has a use for them yet, and a prop no renderer reads is a contract waiting to be believed. The next tranche must either add them deliberately or fold their fields into `coverage`, and say which |

**The MEDIUM and NIT findings are not discharged either.** The design records them as *Addressed*,
but "addressed in the design" is not "built": only the three items above exist in code.

---

## READY TO PASTE INTO `RAMA_AGI_MASTER_SPEC.md`

**This branch does not edit the spec.** Round 2 of the build wrote the record in as Section 126 and
ledger row 146; both numbers were claimed by other work on `dev` while this tranche was in review
(Section 126 is *The scorecard that measured nothing*, row 146 its ledger entry), so the spec edit was
dropped when the branch was rebased and the two blocks below carry the next free numbers instead —
**Section 129** and **row 149**, 128 being reserved by the in-flight autonomy design and 130/150 by the
context-store work. The in-code citations in `chartEmptyState.js`, `PriceChart.jsx`, `StockMind.jsx`,
`PopoutPanel.jsx` and `verifyChartEmptyState.mjs` already read **Section 129**, so pasting these two
blocks is all that is left; nothing in the code changes.

### Block 1 — the spec section, to be appended after Section 128

```markdown
## SECTION 129 — The empty chart stops saying "nothing stored"

Section 123.6 decision 8 deferred data-coverage shading one tranche for a stated reason: **`coverage`
reached one of three `PriceChart` call sites**, and a band drawn in one place of three is a half-feature.
Threading it was named as the first item of the next tranche. This is that item, plus the two defects
that threading exposed. **The fetch queue, the gap-kind taxonomy and the fill affordance from
`docs/research/FETCH_AND_STORE.md` are NOT built here** — the design went through three review rounds
without converging because it covered six subsystems at once, and the six remaining HIGH findings all
fall in the deferred half. They are recorded under `## DEFERRED BY THE ORCHESTRATOR` in that document,
each with the finding ids that must be answered before it is built.

### 129.1 The defect, and why a renderer may not compose this sentence

**An empty canvas said `No 30m bars stored for NIFTY50 over 1Y.` while 400 bars sat on disk.** The store
had them; master's selected dates simply did not overlap any of them. The sentence was false, and it was
false in the way that costs most — it blamed the store, so the obvious next action was to fetch, and the
button offered exactly that: `⇩ Fetch & store them`. **Fetching cannot move bars into a window the
provider does not serve**, so the one affordance on screen could not help.

**The engine was already sending the true sentence.** `ai_backend/main.py`'s `matched == 0` branch
(lines 638-645) returns *"N 30m bars are stored, but none fall between X and Y. Widen the dates, or fetch
more history."* It arrives as `res.data.note`. The renderer talked over it.

### 129.2 Decisions taken in this section

1. **FOUR STATES, DECIDED OUTSIDE THE RENDER.** `src/pages/StockMind/chartEmptyState.js` exports a pure
   `emptyState()` returning `{kind, headline, composed, remedy, detail, hint, tail, action}` for
   `fetching` · `failed` · `nothing-in-window` · `nothing-yet`. **The sentence was wrong for three
   releases because it was composed inside JSX, where nothing could call it.** No callbacks in and no
   JSX out: an action is an `id` the renderer binds to a handler it already has.
2. **PRECEDENCE: `bars > 0` → nothing at all, then `busy`, then `failure`, then `stored > 0`, then
   nothing-yet.** `busy` outranks a stale failure because advising a fetch while one is in flight is
   advice to do the thing already happening. **`failure` outranks every claim about the store**, because
   `coverage` on a failed reply is whatever the last successful reply left behind — a description of a
   moment that has passed.
3. **THE ROUTE'S NOTE IS USED VERBATIM, and `composed` says whose sentence it is.** The route names the
   counts and both dates; nothing composable in the renderer is truer. The fallback for a missing note
   states the count and that the window is empty **without claiming a cause** — no "widen", no
   "provider", no "fetch". The note is never suppressed when the renderer has nothing truer to say.
4. **THE ACTION MUST BE ONE THAT CAN HELP.** `nothing-in-window` offers `✕ clear dates`, never a fetch.
   `nothing-yet` keeps the fetch, which is the one state it was always right for.
5. **AN UNKNOWN END IS LEFT UNSAID.** The detail line first read `stored ${first} → ${last || 'now'}`,
   and the `matched == 0` branch — the only branch this state is reached through — sends `storedFirstBar`
   and **no** `storedLastBar`. So the overlay printed `stored 2019-04-01 → now` beneath a headline saying
   nothing falls in a 2024 window. **If the store reached now, that window would have matched; the false
   half was the one telling master where to aim.** An absent end now renders `stored from <first>` — no
   arrow, no right-hand side. Reading a missing value as `now` was the right instinct ("never render
   undefined") applied to the wrong half of the string.
6. **`meta` and `syncInfo` ARE NOT PROPS.** The design specified an empty state requiring both;
   `PriceChart` is never given either, and inventing them would have been a prop threaded for a reader
   that does not exist. Only what the reply actually carries is threaded: `stored`, `storedFirstBar`,
   `storedLastBar`, `note` from `/ohlcv`, and `error`, `diagnosis.{reason,remedy}`, `detail`,
   `stderrTail` from the `ensureBackendRunning` gate object that `electron/ipc/marketIntel.cjs` returns
   verbatim. The suite asserts the two non-props stay absent.
7. **EVERY FAILURE MODE REACHES EVERY CHART, carrying the reason AND the remedy.** The bridge already
   preserved the diagnosis and it surfaced on one chart for one mode; all four modes
   `verifyEngineDiagnosis.cjs` distinguishes — a bound port, a version mismatch, a live-but-silent
   engine, an unrecognised exit code — plus a route-level `error` alone and the pop-out's thrown-error
   path now land as named failures. **Master's Python engine has never completed a run, so this is the
   state he is actually in.** A generic failure where a named cause exists is the defect.
8. **ONE REPORT OF ONE FAILURE.** Both pages keep a message band above the canvas that predates the
   overlay, and both set it from the same reply. Ungated, master saw the reason, the collapsed `engine
   output` and the knocked URL twice. Both bands are now gated on `bars.length > 0`, so a band covers
   only what the overlay cannot: a message arriving while the previous fetch's candles are still drawn —
   which is also where the truncation note lands.
9. **THE POP-OUT SENDS NO DATES, and that is asserted rather than assumed.** `clear-dates` renders only
   when `onDates` exists, and the pop-out passes `onFetch` alone — so a `nothing-in-window` state there
   would advise widening the dates with no control to widen them. It cannot arise today because the
   pop-out calls `limitForDates(interval, null, null)`, and the suite now fails if dates are threaded
   there, so whoever does it supplies the action first.
10. **THE CALL SITES ARE DISCOVERED, NOT COUNTED.** The threading assertions scan every `.jsx` under
    `src/pages/StockMind` for `<PriceChart`, slice each element and require all three props on each, and
    match attribute names rather than whole expressions. A hardcoded total of three would have left a
    fourth chart in a new file green while reintroducing exactly this defect.

### 129.3 Verified

`scripts/verifyChartEmptyState.mjs`, **96 assertions, 0 failures** (`verify:empty-state`, **appended** to
the `verify` chain after the sessions suite — appended, never reordered, per I11). The three assertions
covering decision 5 were **demonstrated red** by restoring the `→ now` expression and then green on
restore. **Measured in the MAIN workspace after the branch was rebased onto `dev` and `dev`
fast-forwarded to it: `npm run verify` runs 27 scripts, 26 of them reporting counts, at 2,541
assertions and 0 failures; `npx vite build` succeeds in 25.09s** (`StockMind` chunk 99.36 kB / 28.85 kB
gzipped), **so unlike the last four chart sections this one is not reasoning about the bundle — it was
built.** `verifyChartTime.mjs` holds at **197**, `verifyChartDrawings` 232, `verifyChartSessions` 109,
`verifyIndicators` 267, `verifyTimeframes` 123, `verifyEngineDiagnosis` 34, `verifyGlossary` 48,
`verifyModelRoles` 87; `verifyInvariants` 139 with all 17 rows enforced and its one `HELD BY HAND` row
for I15 (Section 124 §9.1's open question to master, not a product of this work), `verifyLoyaltyTripwire`
12 — the loyalty core byte-for-byte what master approved; `auditRenderer` clean at 79 files and 365 IPC
channels. No `.cjs` touched, no dependency added, no protected file touched.

### 129.4 Not verified

**Nothing was seen on a screen.** The Python engine still has never completed a run here, so the
`matched == 0` reply is reproduced from the route's source and the gate object from
`verifyEngineDiagnosis`'s fixtures rather than observed over IPC; `nothing-in-window` has therefore never
been exercised end to end, because exercising it needs a store with bars and a window that misses them.
**The build proves the bundle compiles; it does not prove a single pixel.** There is no renderer test
harness in this project, so the overlay's markup is asserted only by source-level regex — a binding
exists, not that it renders — and colour, wrapping of a long remedy, and whether the collapsed
`<details>` fits a 260px workspace panel are all unverified. Master's next run is the test of all three
items.

### 129.5 Next

The deferred half, in the order its findings must be answered: the **fetch queue** (HIGH 1 the
unspecified dispatcher, HIGH 2 `conflicts()` collapsing twelve windows into one, HIGH 3 key ambiguity on
cancel-then-retry), then **gap kinds and the fill affordance** (HIGH 6 the retention clamp not applied to
fill, and hole/beyond-cap overlapping with no precedence rule), then lazy paging and the older-history
prompt, then `describeRequest()` and the request-contract strip. Three NITs from the approving review are
open and recorded in `docs/research/build-review.json`: the composed `nothing-in-window` fallback still
says "inside the selected dates" in a state only reachable if the renderer discarded bars the reply did
carry; the empty-store note is superseded rather than shown, which is a stronger claim than decision 3
makes; and the failure overlay offers `↻ Try again` on a capability denial, where `stockmind.view` is
absent and no retry can succeed.
```

### Block 2 — the Section 28 ledger row, to be appended after row 150

```markdown
| 149 | The empty chart stops saying "nothing stored" — `coverage` to all three charts, the route's own sentence, the engine's diagnosis everywhere | done | Section 129. Row 143's own next step (Section 123.6 decision 8): **`coverage` reached ONE of three `PriceChart` call sites**, so two charts could not bound their date pickers and could only ever say "nothing stored". Threading it exposed two defects worse than the missing band. **(1) A FALSE HEADLINE ON A FULL STORE.** `No 30m bars stored for NIFTY50 over 1Y.` printed with **400 bars on disk** — master's dates simply did not overlap them — and the only button offered `⇩ Fetch & store them`, which **cannot move bars into a window the provider does not serve**. The engine was already sending the true sentence (`ai_backend/main.py` 638-645, *"N bars are stored, but none fall between X and Y…"*), it arrives as `res.data.note`, and the renderer talked over it. Now four states decided by a pure `src/pages/StockMind/chartEmptyState.js` — `fetching` · `failed` · `nothing-in-window` · `nothing-yet` — because **the sentence was wrong for three releases precisely because it was composed inside JSX where nothing could call it.** Precedence `bars > 0` → nothing, `busy`, `failure`, `stored > 0`, nothing-yet; **a failed reply outranks any claim about the store**, since `coverage` on a failure describes a moment that has passed. **(2) A FALSE DETAIL REPLACED THE FALSE HEADLINE and was caught in review:** the line read `stored ${first} → ${last || 'now'}` and the `matched == 0` branch — the only branch that state is reached through — sends `storedFirstBar` and **no** `storedLastBar`, so the overlay printed `stored 2019-04-01 → now` under a headline saying nothing falls in a 2024 window. **If the store reached now, that window would have matched.** An unknown end is now left unsaid: `stored from <first>`, no arrow. **(3) THE ENGINE'S DIAGNOSIS REACHES EVERY CHART AND EVERY MODE** — the bridge already returned the gate object verbatim with reason, remedy, detail and `stderrTail`, and it surfaced on one chart for one mode. **Master's engine has never completed a run, so this is the state he is actually in.** Also: both message bands gated on `bars.length > 0`, because ungated the chart tab reported one failure twice with two copies of the collapsed `engine output`; `meta`/`syncInfo` deliberately NOT invented as props (the design assumed them, `PriceChart` is never given either); the pop-out asserted to send no dates, so `clear-dates` cannot be advised where there is no control for it; and the threading assertions **discover** call sites by scanning `src/pages/StockMind/*.jsx` rather than counting three, so a fourth chart in a new file cannot pass. **PROCESS, recorded because it will recur: this row and Section 129 were written as 146 and 126, and `dev` took both numbers while the tranche was in review — the spec edit was DROPPED at the rebase in favour of `dev` and renumbered here, which is why `RAMA_AGI_MASTER_SPEC.md` is the one file this branch does not touch. Three concurrent workflows editing the most contended file in the project means a section number reserved at the start of a tranche is not reserved at the end of it.** **VERIFIED: `verifyChartEmptyState.mjs` 96 assertions, 0 failures**, three of them demonstrated red by restoring the `→ now` expression; `verifyChartTime.mjs` unmoved at **197**; and — unlike rows 140-143, every one of which could only reason about the bundle — **MEASURED IN THE MAIN WORKSPACE AFTER THE MERGE: `npm run verify` 27 scripts / 26 reporting suites / 2,541 assertions / 0 failures, and `npx vite build` GREEN IN 25.09s** (`StockMind` chunk 99.36 kB, 28.85 kB gzipped), with `verifyInvariants` 139 (all 17 rows enforced, one `HELD BY HAND` row for I15 which is Section 124 §9.1's standing question to master), `verifyLoyaltyTripwire` 12 ALL PASS, and `auditRenderer` clean at 79 files / 365 IPC channels. The review that approved this (`docs/research/build-review.json`, verdict APPROVED) re-ran the chain itself rather than trusting the recorded numbers. **NOT VERIFIED: nothing seen on a screen** — the build proves the bundle compiles and proves no pixel; there is no renderer test harness, so the overlay's markup is asserted only by source-level regex, and colour, long-remedy wrapping and whether the collapsed `<details>` fits a 260px workspace panel are all unchecked. **The Python engine still has never completed a run here**, so the `matched == 0` reply is read off the route's source rather than observed and `nothing-in-window` has never been exercised end to end. **THREE NITS LEFT OPEN BY THE APPROVING REVIEW, each a sentence that is true today only because of a path the route cannot currently produce:** the composed `nothing-in-window` fallback still claims "inside the selected dates" in the one state where bars arrived and the renderer discarded them; the empty-store note is superseded rather than shown, which decision 3's wording overstates; and the overlay offers `↻ Try again` on a `stockmind.view` capability denial, where the overlay's fetch button is the one chart control not gated on the capability and no retry can ever succeed. **NEXT, deliberately deferred by the orchestrator** (recorded under `## DEFERRED BY THE ORCHESTRATOR` in `docs/research/FETCH_AND_STORE.md` with the blocking finding ids): the **fetch queue** — resolve HIGH 1 (unspecified dispatcher), HIGH 2 (`conflicts()` collapsing twelve windows into one) and HIGH 3 (key ambiguity on cancel-then-retry) in the design first; then **gap kinds and the fill affordance** — resolve HIGH 6 (the retention clamp not applied to fill; hole/beyond-cap overlap with no precedence rule); then lazy paging and the older-history prompt; then `describeRequest()` and the request-contract strip; and the three NITs above, the first of which wants the raw reply bar count passed into `emptyState` beside `candles.length` so "arrived" and "drawn" stop being the same number. |
```
