# DESIGN REVIEW — FETCH_AND_STORE.md Phase 3 (revision 3)

**Reviewed.** `docs/research/FETCH_AND_STORE.md` §3.0 – §3.15, read fresh, without the context that
produced it.

**Worktree.** `c:\CodeBase\Velvet_UI\Velvet\Rama_AGI\.worktrees\fetch-store`, branch
`chart/fetch-and-store`. Repo root `c:\CodeBase\Velvet_UI\Velvet\Rama_AGI` is at `c595342`; the
worktree branch tip is `9669eea`, which is the HEAD the design claims to have been read against.

**Method.** Every claim the design makes about existing code was re-read off source in this worktree.
No build, no test suite, and no engine was run — per the step's instruction and because
`node_modules` is not installed here. Engine behaviour that cannot be exercised on this machine is
judged only on whether the design *called it out as deferred*.

**Verdict.** `CHANGES_REQUESTED` — **6 HIGH, 12 MEDIUM, 6 NIT**.

The design is markedly stronger than its predecessor: the five required decisions are each made
explicitly and each carries a reason; `classifyOutcome` is now an ordered rule set with `wantBars`
excluded by name; `diagnoseFailure` is correctly scoped away from a live engine's own error; the
retention clamp on `⇠ older` is right and well argued. The HIGH findings below are of one family —
**the queue and the gap-fill affordance do not yet work as specified against the code they land on**:
nothing dispatches a queued job, `conflicts()` collapses `fill all` to a single job, a retried key
cannot be told apart from the cancelled attempt it replaces, two of the three canvas states have no
data path into `PriceChart`, the `nothing-yet` headline is false in the one case E15 was written for,
and `fill` is offered for holes the provider can never serve.

---

## Findings

### 1. HIGH — nothing dispatches a queued job: the queue has no specified pump

**Where.** §3.4 (`fetchQueue.js` — "pure functions over a plain state object, no React, no timers, no
IPC. `StockMind.jsx` holds the state in `useState` and drives it"), `settle()`'s step 3 ("start the
next job in each free lane"), §3.13's `StockMind.jsx` row.

**Problem.** `start()` and `settle()` both move a job to `running`, and both are pure. Nothing in the
design says who issues `window.rama.marketIntel.ohlcv(...)` for a job that has just become `running`.
For the job master presses a button for, `loadBars` can do it inline. For the *next* job in a lane —
the one `settle()` step 3 starts, and every job after the first of a `fill all` — there is no
specified caller, so an eight-job `fill all` would mark job 2 `running` and never send it. The obvious
implementation (a `useEffect` on `queue` that dispatches anything `running`) has a double-dispatch
hazard that is also unspecified: React 19 StrictMode double-invokes effects in development, and the
`setQueue` inside the dispatch re-runs the effect. Verified: `loadBars` today is a single `useCallback`
with no in-flight bookkeeping (`StockMind.jsx:214-241`), so there is nothing existing to inherit.

**Fix.** Specify the pump as part of §3.4, with a dispatch guard that is not queue state:

```js
// StockMind.jsx — the ONE place an IPC call is issued for a job. `dispatchedRef` is not queue
// state: a double-invoked effect must not produce a second request, and queue state cannot
// distinguish "marked running" from "already sent".
const dispatchedRef = useRef(new Set());

useEffect(() => {
  for (const job of queue.jobs) {
    if (job.state !== 'running') continue;
    if (dispatchedRef.current.has(job.id)) continue;
    dispatchedRef.current.add(job.id);
    (async () => {
      const reply = await window.rama.marketIntel.ohlcv({ /* from job */ });
      setQueue((q) => {
        const r = settle(q, job.id, reply, selectionRef.current);
        if (r.wrote) { setBars(reply.data?.bars || []); setBarsMeta(reply.data || null); }
        return r.state;
      });
      dispatchedRef.current.delete(job.id);
    })();
  }
}, [queue]);
```

and state in §3.4 that `start()` / `settle()` only *authorise* a dispatch — they never perform one —
and that `dispatchedRef` is the idempotence guard. §3.12 should assert that `settle()` leaves at most
one `running` job per lane, and the source-reading assertion that exactly one `ohlcv(` call site
exists in `StockMind.jsx`.

---

### 2. HIGH — `conflicts()` makes `fill all` collapse to one job, contradicting E16 and §3.12

**Where.** §3.4 `conflicts(a, b)`; §3.4 states table (`superseded` ← "a conflicting job replaced it …
`enqueue()` via `conflicts()`"); §3.2 `enqueueAll`; E16; §3.12 ("`enqueueAll` with 12 windows and 8
free slots accepting 8").

**Problem.** As written,

```js
if (a.mode === 'disk') return b.mode === 'disk';
return b.mode !== 'disk' && a.interval === b.interval;
```

two `gap` jobs for *different* date windows on the same interval **conflict**. Since `enqueue()`
supersedes conflicting jobs, `enqueueAll(state, [12 windows])` supersedes each window as it adds the
next and ends with exactly one live job. `MAX_QUEUE = 8` becomes unreachable, `capacity()` always
returns 8 or 7, E16's "8 of 12 gaps were queued" cannot happen, and §3.12's assertion would fail
against the design's own `conflicts`. The same rule also silently retires a `running` full-interval
sync the moment master presses `⇠ older`, discarding its report.

**Fix.** Conflict must mean *"these two would fetch the same thing, or the newer subsumes the older"*,
not *"same interval"*:

```js
// Two provider-class jobs conflict only when one subsumes the other. A full-interval `provider`
// sync fetches the provider's whole window, so it subsumes any older/gap window on that interval
// and is subsumed by a newer one. Two windowed jobs for DIFFERENT windows are complementary —
// that is what `fill all` is — and must coexist.
export function conflicts(a, b) {
  if (a.symbol !== b.symbol || a.exchange !== b.exchange) return false;
  if (a.mode === 'disk' || b.mode === 'disk') return a.mode === b.mode;
  if (a.interval !== b.interval) return false;
  if (a.mode === 'provider' || b.mode === 'provider') return true;   // subsumption
  return a.from === b.from && a.to === b.to;                          // same window only
}
```

and add a §3.12 assertion that twelve `gap` jobs with twelve distinct windows produce twelve
non-superseded jobs before `MAX_QUEUE` is applied.

---

### 3. HIGH — a retry reuses the same `key`, so a cancelled attempt's late reply is written as the retry's outcome

**Where.** §3.4 ("`retry(state, key)` creates a **new** job with the same key and
`attempt = prev.attempt + 1`"), `settle(state, key, reply, selection)`, `cancel(key)`, `lanes: {disk,
provider}` holding "the key currently holding each lane", §3.5(d)'s `onCancel(key)` / `onRetry(key)`.

**Problem.** `key` is the identity used by `settle`, `cancel` and both lane tokens, and a retry
deliberately duplicates it. Walk the cancel-then-retry path the design itself specifies: job A
(`attempt 1`, `running`, provider lane token = `key`) is cancelled — it goes terminal, the lane stays
reserved. Master presses `↻`; job B (`attempt 2`, same `key`) is enqueued. A's reply then arrives and
`settle(state, key, reply, selection)` matches the lane token (it *is* `key`) and looks up "the job
with this key" — which now matches two jobs. If it resolves to B (non-terminal, current),
**A's discarded reply is written as B's outcome**, directly violating the design's own cancel rule 2
("its reply, when it arrives, is discarded") and the invariant §3.9 assigns to `isCurrent` + `settle`.
`cancel(key)` and `onCancel(key)` are ambiguous the same way.

**Fix.** Separate identity from conflict. Keep `key` for dedupe and `conflicts()`; add a unique
per-attempt `id` and key everything that addresses *an attempt* on `id`:

```js
job.key = `${symbol}|${exchange}|${interval}|${mode}|${from}|${to}`;  // dedupe + conflicts
job.id  = `${job.key}#${job.attempt}`;                                // identity
lanes   = { disk: string|null, provider: string|null };               // holds an ID, not a key
settle(state, id, reply, selection); cancel(id); retry(state, id);
```

`onCancel`/`onRetry` take `id`; the queue strip keys its rows on `id`. Add a §3.12 assertion: cancel
attempt 1, retry to attempt 2, deliver attempt 1's reply → `wrote === false`, attempt 2 still live,
lane released once.

---

### 4. HIGH — `nothing-yet` prints "No 30m bars stored" when bars *are* stored, and suppresses the sentence that says otherwise

**Where.** §3.5(d) states table (`nothing-yet`: "no bars, no failure, nothing ever stored", headline
"the existing sentence"); E15; §3.5 "Who owns a failure" (`barsNote` "is suppressed while the canvas
is showing a non-`none` empty state"); §3.12's no-regression assertion on today's `nothing-yet` text.

**Problem.** Two sections disagree, and the disagreement produces a false claim on screen. E15 —
"a sync that stored 400 bars none of which fall in master's window" — routes to "the canvas shows
`nothing-yet` with the contract". But `nothing-yet`'s trigger is "nothing ever stored", and its
headline is verified verbatim at `PriceChart.jsx:2105-2110`: *"No 30m bars stored for NIFTY50."*
With 400 bars stored that sentence is false. Worse, the one true sentence — the route's own
`"{stored} {interval} bars are stored, but none fall between {from} and {to}. Widen the dates, or
fetch more history."`, verified at `ai_backend/main.py:638-645` — arrives as `res.data.note`, becomes
`barsNote`, and is then **suppressed** by the ownership rule because the canvas is non-`none`. The
offered action is `⇩ Fetch & store them`, which is fact 9's un-followable remedy: a fetch will not
bring bars into a window the provider does not serve. Master is shown a false headline, a useless
button, and no sign of the accurate sentence sitting on the payload.

**Fix.** Add a sixth state and let the engine's own note be the headline:

| State | When | Overlay | Button |
| --- | --- | --- | --- |
| `nothing-in-window` | no bars, no failure, `coverage.stored > 0` (or `meta.bars > 0`) | the route's `note` verbatim, plus `coverage.first → coverage.last` as the window that *does* exist | **✕ clear dates** (calls the existing `onDates('','')`) and, only when `supportsWindowedSync`, `⇩ fetch this window`; **never** a bare `⇩ Fetch & store them` |

Narrow `nothing-yet`'s trigger to `!(coverage?.stored > 0)` and keep its text and button unchanged, so
§3.12's Section 107 no-regression assertion still holds. State that `barsNote` is suppressed only when
the canvas headline *is* `barsNote` — which for `nothing-in-window` it is.

---

### 5. HIGH — `nothing-upstream` and the attributed freshness line have no data path into `PriceChart`

**Where.** §3.5(d) prop contract (eight new props: `failure`, `queue`, `onCancel`, `onRetry`,
`onLoadOlder`, `onFillGap`, `onWhy`, `supports`) versus §3.5(d)'s own
`emptyState({ bars, busy, failure, meta, syncInfo, intervalId, symbol, rangeId, contract })` and
§3.3's `describeFreshness(meta, syncInfo, receivedAt, now)`; §3.13's `PriceChart.jsx` row ("the
freshness line with `InfoTip id="freshness"`"); §3.2's `coverage` superset.

**Problem.** `emptyState` requires `meta` and `syncInfo`; `PriceChart` is given neither. Verified
against source: the prop list is `PriceChart.jsx:256-281` and carries no `meta`, no `syncInfo` and no
`note`. The `coverage` superset adds only `stored`, `fetchedAt`, `source`, `truncated`, `ranges`. So
inside `PriceChart`:

- `nothing-upstream` is **unreachable** — its sole trigger is `syncInfo.reason === 'no provider
  returned data'`, and `providersTried` is needed for its body. That is one of the three canvas states
  Decision 5 and Phase 2 row 4 both require.
- `describeFreshness` cannot be called with its specified signature, and `attributed` — gated on
  `syncInfo.fetched === true` — can never be true, so the chart's freshness line can never say
  *"Yahoo answered with 412 new bars"*. §3.12 asserts that branch.

**Fix.** Pick one and write it down. Either add two optional props —

```
meta     = null   // the reply's `meta` block: lastFetchedAt, lastSource, bars, barsAdded
syncInfo = null   // the reply's `syncInfo` block: reason, fetched, source, barsAdded, providersTried, supports, clamped
```

— which keeps `describeFreshness`/`emptyState` signatures as specified and is additive (both default
`null`, every existing call site keeps working); **or** fold the five fields the renderer actually
reads into the `coverage` superset (`reason`, `providersTried`, `fetched`, `barsAdded`, `clamped`) and
change both function signatures to take `coverage`. The first is smaller and matches the payload
shape. Either way, state that `supports` arrives as its own prop (it is page-retained, not
per-reply), and add a §3.12 assertion that `nothing-upstream` is reachable from props alone.

---

### 6. HIGH — `fill` is offered for holes the provider can never serve, and `hole` vs `beyond-cap` has no precedence rule

**Where.** §3.2 "Filled." (`describeCoverage(model, intervalId, { supports, listMax })`, actions gated
on `supportsWindowedSync` only), the three `kind`s table, §3.1's retention clamp (applied in
`olderWindow` only), E16.

**Problem, two parts.**

(a) The retention clamp that §3.1 argues is load-bearing — "a provider that serves 'the last 21
sessions' cannot serve sessions 22–42 however the request is phrased" — is applied to `⇠ older` and
**not** to `fill`. `describeCoverage` takes no `now` and consults no horizon, so once §3.10 lands,
`fill` buttons appear for every hole. And the design's own hole-formation scenario (Phase 1 fact 11)
puts intraday holes *outside* the rolling window by construction: fetch 30m covering D−21…D, return 42
sessions later, provider serves D+21…D+42, and the hole sits 21–42 sessions back — beyond a 21-session
rolling cap. So on capped intraday intervals, the interval class where holes form at all, `fill` is
almost never servable. That is fact 9 — "the message names a remedy the system does not implement" —
re-created by the affordance the design calls its most important guard.

(b) `hole` is "a run of missing bars between two stored runs" and `beyond-cap` is "older than
`PROVIDER_CAP_SESSIONS[intervalId]` sessions". A hole 25 sessions old on a 30m chart satisfies both and
no precedence is stated; nor is the anchor for "older than N sessions" (now? the right edge of the
data? the left edge?).

**Fix.** State the precedence and apply the clamp in the pure function:

```js
// chartCoverage.js — kind precedence, and the horizon the provider actually serves.
// ANCHOR IS `now`, because the provider's window is rolling and is measured from today.
const capSessions = PROVIDER_CAP_SESSIONS[intervalId];
const horizonYmd  = capSessions == null ? null : ymdMinusSessions(toYmd(now), capSessions);
// 1. beyond-cap wins over hole: a run older than the horizon is not a hole Rāma can fill,
//    it is history free data does not reach.
const kind = (horizonYmd && gap.toYmd < horizonYmd) ? 'beyond-cap' : 'hole';
```

`describeCoverage(model, intervalId, { supports, listMax, now = new Date() })`; an action is emitted
only when `supportsWindowedSync(supports)` **and** `kind === 'hole'`. For `beyond-cap` runs, `text`
carries `describeLimit(intervalId)` and `actions` stays empty — the same treatment §3.1 gives
`beyond-retention`. Add to §3.14 the honest consequence: on capped intraday intervals the band is the
deliverable and the button is rare. §3.12 should assert a 30-session-old hole on `30m` yields
`kind: 'beyond-cap'`, no action, and `describeLimit`'s sentence; and that the same hole on `1d` yields
`kind: 'hole'` with an action.

---

### 7. MEDIUM — `coverageRanges`' signature cannot produce two of its three gap kinds, its `leftEdge`, or `source: 'store'`

**Where.** §3.2 `coverageRanges(candles, intervalId, opts)` and the "**Two** injected inputs" table
(`opts.ymd`, `opts.starts`); the returned shape (`source: 'bars' | 'store'`, `leftEdge: 'store' |
'payload-ceiling'`, `kind: 'asked-absent'`); §3.12 ("`truncated` → left edge `payload-ceiling`").

**Problem.** The function is declared to take exactly two injected inputs, and neither supplies:
`truncated` (needed for `leftEdge`), the requested window and the store's first/last bar (needed for
`asked-absent`, defined as "between the window master requested and the first/last stored bar"), or
the store's own `ranges` (the only way `source: 'store'` could ever be returned — §3.10 item 5).
An implementer following §3.2 literally cannot satisfy §3.12.

**Fix.** Widen the declared `opts` and say which fields are optional:

```
coverageRanges(candles, intervalId, {
  ymd, starts,                      // the two Maps, as specified
  truncated = false,                // coverage.truncated — sets leftEdge
  storedFirst = null, storedLast = null,   // coverage.first/last — the store's edges
  requestedFrom = null, requestedTo = null, // fromDate/toDate — asked-absent needs both
  ranges = null,                    // §3.10 item 5; when present, source === 'store'
  now = new Date(),                 // the beyond-cap / horizon anchor (finding 6)
})
```

---

### 8. MEDIUM — §3.2 and E16 give `enqueueAll`'s note two different numbers

**Where.** §3.2 ("`note` is *'4 of 12 gaps were queued; the fetch queue holds 8 at a time…'*") versus
E16 and §3.15 row 10 ("*'8 of 12 gaps were queued…'*", "accepting 8, reporting 4").

**Problem.** With twelve windows and eight free slots, `accepted` is 8 and `rejected` is 4. §3.2's
example sentence reports the rejected count as the queued count. §3.12 asserts the E16 wording, so a
test written from §3.2 and a test written from E16 contradict each other, and the sentence is the one
string master reads.

**Fix.** Correct §3.2 to the E16 wording and state the template once:
`` `${accepted} of ${total} gaps were queued; the fetch queue holds ${MAX_QUEUE} at a time, so press ⇩ fill all again when these finish.` ``

---

### 9. MEDIUM — `wantBars` is 20,000 on every uncapped interval with no window selected

**Where.** §3.3 (`const wantBars = fromDate ? raw : (cap ?? raw);` and "this figure is what the
SENTENCE may print"); §3.12 (asserts only that *"`wantBars` on the default unfiltered 30m view is 263
and the text never contains `20,000`/`20000`"*).

**Problem.** Verified: `limitForDates` returns `MAX_BARS` (20000) whenever `from` is falsy
(`timeframes.js:259-263`), and `capBarsFor` returns `null` for `1d`/`1wk`/`1mo`
(`timeframes.js:93-99`). So on `1d` with no dates — a common view — `wantBars` is 20,000 and the
stated rule permits printing it. The design identifies this exact trap for the capped case
("inheriting it would make the contract sentence claim master asked for twenty thousand bars") and
then re-opens it for the uncapped case; the test matrix closes only the capped half.

**Fix.** Make the absence of a printable ceiling explicit rather than falling back to the payload cap:

```js
// No window and no provider cap means there is no ceiling worth printing: the depth is the
// engine's `want_years` (30 on an empty store, 1 afterwards), not a bar count.
const wantBars = fromDate ? raw : (cap ?? null);
const wantBarsIsCeiling = !fromDate;
```

and extend §3.12: for each of `1d`/`1wk`/`1mo` with no dates, `wantBars === null` and `text` contains
no bar figure and no `20,000`/`20000`.

---

### 10. MEDIUM — the gate's start-failure branch carries no remedy, so §3.5(d)'s "reason **and** remedy" is false there

**Where.** §3.5(d) (`could-not-ask`: "`failure.error` (reason **and** remedy — `diagnoseFailure` and
§3.5(b)'s sentences both put both in it)"); §3.5 opening ("`aiProcess.diagnoseFailure` is **total** —
every input, silence included, yields a reason and a remedy").

**Problem.** Verified at `marketIntel.cjs:44-56`: the start-failure branch of `ensureBackendRunning`
does **not** call `diagnoseFailure`. It builds its own object with
`diagnosis: { reason: started.error || 'the engine could not be started', remedy: '' }`, and `error`
appends the remedy only `if (diagnosis.remedy)`. So on that branch the headline is
`"StockMind's engine could not be started: <raw spawn error>"` — a reason, no remedy, and the raw
error promoted to the headline. `stderrTail` is `[]` there too. This is the branch that fires when the
Python interpreter is missing, which on master's machine is the likeliest engine-down shape, and the
step requires the existing diagnosis to be routed through rather than a generic failure.

**Fix.** Either (a) route that branch through the same diagnoser at the boundary §3.5(b) already
annotates —

```js
if (!gate.ok) {
  const diagnosis = gate.diagnosis?.remedy
    ? gate.diagnosis
    : aiProcess.diagnoseFailure({ stderr: [], exit: null, running: false });
  return { ...gate, kind: 'engine-down', diagnosis,
           error: `StockMind's engine is not running: ${diagnosis.reason}.`
                + (diagnosis.remedy ? ` ${diagnosis.remedy}` : ''),
           detail: gate.detail ?? (gate.error || null) };
}
```

— or (b) state plainly in §3.5(d) and §3.8 that `failure.error` carries a remedy on the poll-timeout
and transport paths and may carry reason only on the start-failure path, and assert that in
`verifyEngineDiagnosis.cjs` instead of asserting a remedy unconditionally. (a) is the better end state
and is additive. Either way the blanket claim has to go.

---

### 11. MEDIUM — `engineDiagnosis` is described as a read with no cost, but it spawns the engine and polls for 8 seconds

**Where.** §3.5(c) ("It calls `ensureBackendRunning()` and returns the gate object … and reaches no
provider and spends no engine time"); `askWhy`; §3.7's `engineDiagnosis` row; E17.

**Problem.** Verified at `marketIntel.cjs:40-56`: `ensureBackendRunning()` calls
`aiProcess.startPythonBackendPublic()` when the process is not running, then polls `/health` for up to
8 seconds. So pressing `why?` **attempts to start the Python process** and blocks for up to ~8s. Three
consequences the design does not state: `why?` is not a read; there is no pending/disabled state
specified for it, so master can press it repeatedly and queue start attempts; and E17's
`{ok: true}` → *"the engine is answering now"* can be true **because `why?` just started it**, which
the design presents as an observation about something that changed on its own.

**Fix.** Choose and state one:

- **Diagnose without starting** (matches the described semantics):
  ```js
  // A question, not an action. `getRunningStatus` + `diagnoseFailure` answer "why" without
  // spawning anything — pressing `why?` must not change the thing it is asking about.
  async function engineDiagnosis() {
    const st = await aiProcess.getRunningStatus?.();
    const py = st?.python || {};
    if (py.running) return { ok: true };
    const diagnosis = py.diagnosis || py.notAnswering
      || aiProcess.diagnoseFailure({ stderr: py.lastStderr || [], exit: py.lastExit || null,
           running: false, interpreter: py.interpreter || null, backendDir: py.backendDir || null });
    return { ok: false, error: `StockMind's engine is not running: ${diagnosis.reason}.`
      + (diagnosis.remedy ? ` ${diagnosis.remedy}` : ''), diagnosis,
      stderrTail: Array.isArray(py.lastStderr) ? py.lastStderr.slice(-4) : [], detail: null };
  }
  ```
- **Or keep `ensureBackendRunning()`** and say so: add a `whyBusy` state that disables `why?` while
  the call is out, and have `describeDiagnosis` word the `{ok: true}` case as *"Rāma asked its engine
  manager and the engine is answering now — it may have started when you asked."*

---

### 12. MEDIUM — `'Response too large'` is routed to `diagnoseFailure`, which is the defect finding 3 of the previous round removed

**Where.** §3.5(b) `transportKind` (`return 'transport'; // status 0, no status, 'Response too
large', a refusal`); §3.7's "connection refused, socket error, oversized body" row ("**this** is where
`diagnoseFailure` is right: there is no body").

**Problem.** Verified at `http.cjs:129-131`: the size cap is tripped **while reading a response the
engine is already sending** — `reject(new Error('Response too large'))` inside the `res.on('data')`
handler. The engine answered. Sending that to `diagnoseFailure`, whose branches key on stderr, exit
code and `running`, yields the cold-start-wait remedy for a live engine — precisely the
"confidently wrong rather than vague" failure §3.5(b) was rewritten to remove, left in place for this
one case. The remedy master needs is "narrow the window", which the design already writes for
`timeout`.

**Fix.** Add one rule ahead of the status rule and one sentence:

```js
if (/^Response too large$/.test(msg)) return 'engine-error';   // it answered — with too much
```

```js
if (kind === 'engine-error' && /^Response too large$/.test(String(res?.error || ''))) {
  return { error: 'The engine answered with more data than Rāma will accept in one reply. '
    + 'Narrow the window or pick a coarser interval; nothing was stored for this request.',
    detail: String(res?.error || '') };
}
```

and correct §3.7's row so `transport` means "no answer at all".

---

### 13. MEDIUM — `auditRenderer.cjs` is named in the verification bar but cannot run in this worktree

**Where.** §3.12 ("the bar for this tranche is … plus `auditRenderer.cjs`, `verifyGlossary.mjs`, …");
§3.14's not-verified list, which calls out `vite build` but not this.

**Problem.** Verified: `auditRenderer.cjs:194-197` requires `@babel/parser` and `@babel/traverse`, and
`node_modules` does not exist in this worktree (it exists only in the main workspace). So the one
suite that would catch the new `preload.cjs` method without its `market:engine-diagnosis` handler —
`findIpcMismatches` / `auditIpcParity` — is unrunnable here, exactly as `vite build` is. The design's
own standard is that an admitted gap beats a plausible claim.

**Fix.** Move `auditRenderer.cjs` out of the in-worktree bar and into §3.14 beside `vite build`, with
the recovery stated: *"`auditRenderer.cjs` needs `@babel/parser` from `node_modules` and therefore runs
only in the main workspace after this branch merges; until then the preload↔handler pairing is asserted
by the source-reading check added to `verifyEngineDiagnosis.cjs`."* Add that source-reading assertion
(preload names `marketIntel.engineDiagnosis` → `market:engine-diagnosis` is a key of `readOnly`) so the
coverage is not simply dropped.

---

### 14. MEDIUM — `nothing-read`'s sentence claims the provider was not reached, including for a disk read that was never meant to reach it

**Where.** §3.4 `classifyOutcome` (`if (count === 0) return 'nothing-read'`) and the `nothing-read`
wording ("plus one sentence of ours: *'Rāma reached the engine and the engine did not reach the
provider for this one.'*"); the two-lane table (`mode: 'disk'`).

**Problem.** `classifyOutcome(reply)` sees only the reply, not the job's mode. Verified at
`main.py:598-604`: the automatic mount and filter-effect disk reads (`sync: false`) on a
never-stored instrument return `count: 0` with `syncInfo = {"fromStore": true}`. So every first view
of a new instrument produces a terminal `nothing-read` job whose sentence complains that the provider
was not reached — for a job whose entire contract (§3.3's `disk` text: *"Reads what is already on this
machine. No network, no provider call, nothing stored."*) is that it never asks the provider. Two
sentences about the same job contradict each other, and the design's thesis is that Rāma does not make
claims it cannot support.

**Fix.** Make the sentence mode-aware while keeping `classifyOutcome` a pure function of the reply:

```js
// fetchQueue.js — the classification is the reply's; the sentence is the job's.
export function outcomeText(job, reply) {
  if (job.state !== 'nothing-read') return …;
  if (job.mode === 'disk') return 'Nothing is stored on this machine for this one yet — '
    + 'that is a fact about the store, not a failure. ⇩ Fetch & store them reaches the provider.';
  return `${reason}. Rāma reached the engine and the engine did not reach the provider for this one.`;
}
```

and assert both wordings in §3.12.

---

### 15. MEDIUM — `MAX_QUEUE` accounting against terminal jobs is unstated, and `jobs` grows without bound

**Where.** §3.4 (`MAX_QUEUE = 8`, "counting **provider-reaching jobs only**"; `capacity(state)`
"returns the free provider slots and is the one place that arithmetic lives"); §3.2's `enqueueAll`;
§3.3's `blocked` "the fetch queue is full".

**Problem.** Terminal jobs must stay in `jobs` — `↻` on a failed job is a specified affordance — but
whether `capacity()` counts them is never said. If it does, eight failures permanently block the fetch
button with the sentence "the fetch queue holds 8 provider requests at a time", which is false. And
nothing bounds `jobs`: over a session of automatic disk reads it grows unboundedly, which is the same
class of thing the design was careful to remove when it deleted `MAX_SUPPORTS_KEYS`.

**Fix.** State both:

```js
const LIVE = new Set(['queued', 'running']);
const providerClass = (j) => j.mode !== 'disk';
// Only LIVE provider jobs occupy a slot. A terminal job is a record, not a reservation —
// otherwise eight failures would report a full queue that holds nothing.
export function capacity(state) {
  return MAX_QUEUE - state.jobs.filter((j) => providerClass(j) && LIVE.has(j.state)).length;
}
// The record is bounded: oldest TERMINAL jobs are dropped first, live jobs never.
export const MAX_JOBS = 40;
```

---

### 16. MEDIUM — `opts.ymd` is specified as built inside the `candles` memo, which currently returns a bare array

**Where.** §3.2 ("`opts.ymd` is built **inside the same `useMemo` that builds `candles`**, from the raw
bar that produced each candle, so the alignment question cannot arise at all"); §3.15 row 20.

**Problem.** The alignment reasoning is correct and verified — `PriceChart.jsx:533-544` maps `bars`,
drops bars with an unusable time or a non-finite price, then de-duplicates consecutive equal times, so
`candles[i]` and `bars[i]` diverge after the first drop. But the memo returns an array, and `candles`
is consumed by `volumes`, `starts`, `countRef`, `last`/`prev`, the aria text and the data effect.
Producing `ymd` from inside it requires changing its return shape and every consumer, or adding a
second memo that re-implements the drop/dedupe filter — which is the drift the design is trying to
avoid. Neither is specified.

**Fix.** Name the refactor:

```js
// One pass, two outputs: the series and the date of the raw bar each candle came from. Returned
// together because a parallel array built in a second pass would drift from this one's filters.
const { candles, ymd } = useMemo(() => {
  const out = []; const dates = new Map();
  for (const b of bars || []) {
    const time = toChartTime(b?.date);
    if (time === null) continue;
    if (![b.open, b.high, b.low, b.close].every(finite)) continue;
    if (out.length && String(out[out.length - 1].time) === String(time)) continue;
    out.push({ time, open: b.open, high: b.high, low: b.low, close: b.close, volume: Number(b.volume) });
    dates.set(time, String(b.date).slice(0, 10));
  }
  return { candles: out, ymd: dates };
}, [bars]);
```

and add a §3.12 source-reading assertion that `PriceChart.jsx` contains exactly one `toChartTime(`
call site, so no second pass appears later.

---

### 17. MEDIUM — `describeRequest`'s `selection` parameter has no stated use and is not available at one of its two render sites

**Where.** §3.3 (`describeRequest({ intervalId, fromDate, toDate, rangeId, mode, supports, queue,
selection })`); §3.0 ("`PriceChart` computes … its own request contract from its own props");
§3.5(d) ("There is **no `contract` prop**").

**Problem.** Nothing in §3.3's rules reads `selection`: the `blocked` table needs the provider lane's
occupancy (from `queue`) and whether a symbol is selected. And `PriceChart` cannot build a `selection`
— verified, the prop list has `symbol` but no `exchange`. Passing a whole `queue` object into a pure
contract function also couples it to the queue's internal shape for one boolean.

**Fix.** Reduce the signature to the scalars the rules actually use, so both render sites can satisfy
it:

```
describeRequest({ intervalId, fromDate, toDate, rangeId, mode, supports,
                  hasSymbol = true,          // `blocked: 'nothing is selected'`
                  providerLaneFull = false }) // capacity(queue) <= 0, computed by the caller
```

Callers: `StockMind.jsx` passes `capacity(queue) <= 0`; `PriceChart` passes
`queue ? capacity(queue) <= 0 : false`.

---

### 18. MEDIUM — a `queued` job has no specified sentence, so pressing ⇩ can look like nothing happened for up to 90 seconds

**Where.** §3.4 states table (`queued` — "accepted, nothing in flight", no wording); the cancel rules
(the provider lane stays reserved until the abandoned promise settles); E7; §3.12 ("every **terminal**
state carries a sentence").

**Problem.** After a cancel, the provider lane stays reserved for up to 90 seconds. A new fetch in
that window is accepted, is not `blocked` (the queue is not full), and sits `queued` — and
`isBusyFor` is true, so the loading overlay says *"Fetching 30m bars…"* while nothing is in flight.
The design's own standard — *"a disabled button with no stated cause is a dead end"* — applies here,
and this is the same class as fact 20 ("the spinner clears while a 90-second sync is still running"),
inverted. E7 says "the queue strip says so" but no wording is specified, and §3.12 asserts sentences
only for terminal states.

**Fix.** Specify the two `queued` sentences and assert them:

- lane free, FIFO position *n*: *"Queued — {n} ahead of it."*
- lane held by a terminal (cancelled or superseded) job: *"Queued — waiting for an earlier request
  Rāma stopped waiting for. The engine may still be finishing it; this starts as soon as it ends."*

and change §3.12 to "every state, live or terminal, carries a sentence".

---

### 19. NIT — `selectionRef` is written by two different effects with the same dependency list

**Where.** §3.4 (`useEffect(() => { selectionRef.current = …; }, [sym, exchange, barInterval]);`) and
§3.5's second clear effect, which also sets `selectionRef.current` on the same deps.

**Fix.** Keep one. Delete the standalone effect in §3.4 and cross-reference §3.5's clear effect as the
single writer, since §3.4's own comment already says "written by the same effect that clears the
series".

---

### 20. NIT — the `nearLeftEdge` test fires a state update on every animation frame of a drag

**Where.** §3.1's subscription snippet, which calls `setNearLeftEdge(...)` **above** the existing
quarter-pixel dedupe.

**Problem.** Placing the edge test above the dedupe is correct (verified: `PriceChart.jsx:757-762`
early-returns on an unchanged px-per-bar, which a pure pan does not change). But the existing dedupe
exists because "a drag fires this every frame, and sixty identical state updates a second is a way to
make a chart stutter". React bails out on an identical `useState` value, so this is cheap rather than
free — but the design should not silently reintroduce the thing the comment above it warns about.

**Fix.** Guard with a ref so the setter is called only on a transition:

```js
const nearEdge = from !== null && from <= OLDER_PROMPT_BARS;
if (nearEdge !== nearEdgeRef.current) { nearEdgeRef.current = nearEdge; setNearLeftEdge(nearEdge); }
```

---

### 21. NIT — `olderWindow` mixes a UTC-derived anchor with a local-time horizon

**Where.** §3.1 (`const horizon = ymdMinusSessions(toYmd(now), capSessions);` versus the anchor
`String(rawBars[0].date).slice(0, 10)`).

**Problem.** Verified: intraday stored stamps are naive UTC (`chartTime.js` header, `store.py`
Section 73 comment), so the anchor slice is a UTC date; `toYmd` is explicitly local
(`timeframes.js:236`). In IST those differ by a day between 00:00 and 05:30 local. The +3-day slack in
the session→calendar conversion absorbs it, and `datesForRange` is local too so §3.12's drift
assertion still holds — but the mixing is unstated and is the shape of master's last three reports.

**Fix.** One sentence in §3.1: *"the horizon is computed in local time to agree with `datesForRange`
and the date inputs, while the anchor is a slice of a UTC stamp; the one-day worst-case divergence is
inside `ymdMinusSessions`' +3-day slack and is deliberate, not an oversight."* Add a §3.12 assertion
that `olderWindow` is stable across a `now` of 23:00 and 01:00 local for the same bars.

---

### 22. NIT — the popout is told to pass `coverage` and a freshness line but is given no state to hold them

**Where.** §3.6's table ("`coverage` from its own reply, `failure` from its own reply"); §3.13's
`PopoutPanel.jsx` row.

**Problem.** Verified: `PopoutPanel.jsx:99-107` keeps only `res.data?.bars` and `res.error`; there is
no `meta`/`barsMeta` state to build a `coverage` object from, and §3.13's row does not add one. The
popout also receives no `onFillGap`, so whatever `describeCoverage` returns in `actions` has no
handler there.

**Fix.** Add to §3.13's row: *"new `barsMeta` state set from `res.data` on every settle, from which
`coverage` is built; `onFillGap` is deliberately not passed, so `describeCoverage`'s actions are not
rendered in a popout and its `text` carries the reason."* State the no-actions outcome beside the
existing no-`asked-absent` sentence.

---

### 23. NIT — whether an empty `stderrTail` renders an empty `<details>` block is unstated

**Where.** §3.8 ("`stderrTail` … non-array → `[]`, and the `<details>` block is not rendered");
§3.5(d)'s `could-not-ask` row.

**Problem.** Read literally, the rule covers a *non-array* input but not a genuinely empty array —
which is exactly what `ensureBackendRunning`'s start-failure branch returns (verified,
`marketIntel.cjs:54`). An **engine output** disclosure that opens to nothing is a control that lies
about having something.

**Fix.** Reword to *"absent, non-array **or empty** → the `<details>` block is not rendered at all"*,
and assert the empty case in §3.12 beside the `failure.detail === null` assertion.

---

### 24. NIT — a `superseded` running job's discarded work is worded as a replacement

**Where.** §3.4 states table (`superseded`: "a conflicting job replaced it"); cancel rule 4's wording,
which is careful and correct.

**Problem.** Once finding 2's `conflicts()` is narrowed, the remaining supersede case for a *running*
provider job is a genuine subsumption — but master is told it was "replaced", while the engine may
still be fetching and storing. The cancel sentence already has the right words for this
("The engine may still finish it, and anything it stored will appear on the next read from disk").

**Fix.** Give `superseded`-while-`running` the cancel sentence's second half: *"Replaced by a newer
request. The engine may still finish this one, and anything it stored will appear on the next read
from disk."* `superseded`-while-`queued` keeps a plain *"Replaced before it started."*

---

## Verified Assumptions

Each of these is a claim the design makes about existing code or about the required behaviour; each
was re-read off source in this worktree and holds.

1. `timeframes.js` exports `limitForDates`, `capBarsFor`, `PROVIDER_RANGE_STRING`, `describeLimit`,
   `shortfallNote`, `interval`, `PROVIDER_CAP_SESSIONS`, `datesForRange`, `toYmd`, `MAX_BARS`,
   `allRangesFor` — so §3.3's "`timeframes.js` is therefore **not modified**" is achievable.
2. `capBarsFor('30m')` is `ceil(21 × 375 / 30)` = **263**. The design's 263 is correct.
3. `describeLimit('30m')` produces, verbatim, *"Free data for 30m bars reaches back 1mo — about 263
   bars. Deeper windows are refused by the provider, not by Rāma."*
4. `capBarsFor` returns `null` for `1d`/`1wk`/`1mo`, and `anyPositive >= null` is `true` — the
   null-guard §3.1 insists on is genuinely required.
5. `limitForDates` short-circuits to `MAX_BARS` = 20000 when `from` is falsy.
6. `shortfallNote` returns `null` when `rangeId` is null or the interval is uncapped — so
   `asked-absent`'s absence on the default view is correct, as §3.2 states.
7. `PROVIDER_CAP_SESSIONS` and `PROVIDER_RANGE_STRING` match `providers.INTRADAY_RANGE` for all six
   intraday intervals (`1m`/`2m`→`5d`, `5m`/`15m`/`30m`→`1mo`, `60m`→`2y`).
8. `INTERVALS[].span` is clock minutes for every intraday interval and `SESSION_MINUTES`-based for
   daily and coarser — §3.2's `stepMin = iv.span` is sound for the intraday branch.
9. `INTERVALS` is an array with an `interval(id)` accessor, so §3.2's insistence on an id string
   rather than `INTERVALS[id]` is correct.
10. `PriceChart` has exactly one `subscribeVisibleLogicalRangeChange` handler and it early-returns on
    an unchanged quarter-pixel px-per-bar (`if (step === lastPxRef.current) return;`). A pure pan does
    not change the bar width, so §3.1's correction — track the edge **above** the dedupe — is right.
11. `candles` is built by a `map` that drops bars with an unusable time or non-finite prices and then
    de-duplicates consecutive equal times, so `candles[i]` ≠ `bars[i]` after the first drop. §3.2's
    rejection of a parallel `ymd` array is correct.
12. `starts` is `sessionStarts(candles)`, a `Map<'YYYY-MM-DD', number>`, already built and handed to
    `sessionBands`. `injectedStarts` is module-private in `chartSessions.js` and refuses the whole map
    on one bad entry — §3.2's duplicated refusal rule reproduces it accurately.
13. `sessionStarts` keys on the **UTC** calendar day and `chartTime.toChartTime` treats a naive
    intraday stamp as UTC — so an `ymd` built from `String(bar.date).slice(0,10)` is in the same frame
    as `starts`' keys.
14. `sessionBands` returns `[]` on mixed time types and on `|time| > 8.64e12`; `ChartSessionLayer` is
    `attached`/`detached`/`paneViews`/`updateAllViews`/`redraw` with `zOrder: 'bottom'`, attached via
    `price.attachPrimitive(...)` inside a `try` that `console.warn`s and nulls the ref. §3.2's
    "shaped like the two that exist" and §3.7's degradation row are both accurate.
15. The canvas is always mounted with the empty state as an absolutely-positioned sibling carrying
    `aria-live="polite"` and a dashed border, and the `busy` branch takes precedence. §3.5's
    "Section 107 does not regress" describes the structure correctly.
16. Today's `nothing-yet` text is *"No {label} bars stored for {symbol}{rangeId ? ` over ${rangeId}`
    : ''}."* plus `⇩ Fetch & store them` plus `limitNote` — matching §3.12's no-regression assertion.
17. The `sessions (n)` chip is rendered only when `bands.length > 0` and carries
    `<InfoTip id="sessionBand" />`; `bandNote` joins the canvas `aria-label`. §3.2's chip rules copy a
    real pattern.
18. `coverage` has exactly three readers today: the date-picker `min`/`max`, the `⇤ beginning` button,
    and the `stored {first} → {last || 'now'}` line. All read only `first`/`last`, so §3.2's superset
    is backward compatible (I11).
19. `PriceChart`'s prop list is all-optional-with-defaults and already carries a Section 101 comment
    saying so — the design's additive-props approach matches the file's own convention.
20. `http.cjs`'s `getJson` discards `status` and `body` on failure while `postJson` keeps both
    (`status`, `raw` sliced to 300). §3.5(a)'s change makes them match and leaves `error`
    byte-identical.
21. `CIRCUIT_OPEN_MS` is **not** in `http.cjs`'s `module.exports` (only `MAX_RESPONSE_SIZE` is), so
    §3.5(a) is right to add it rather than assume it.
22. For a genuine 5xx, `request()` returns `{ok:false, status, body}` with **no `error` field**; the
    `HTTP 500` string is synthesised inside `getJson`. §3.5(b)'s insistence on keying `transportKind`
    on the message first and never assuming `res.error` exists for a 5xx is correct.
23. The circuit-open reply is `{ok:false, status: 503, error: 'Circuit open for ${origin}'}` — a 5xx
    status, so the design's ordered rule set (message before status) is necessary, not stylistic.
24. Timeouts surface as `{ok:false, status: 0, error: 'Timeout after ${timeout}ms'}`, matching
    §3.5(b)'s `/^Timeout after \d+ms$/`.
25. `MAX_RETRIES = 2`, `CIRCUIT_THRESHOLD = 4`, `CIRCUIT_OPEN_MS = 20000`; a 5xx calls `recordFail`
    once per attempt. So `retries: 0` for sync both removes the three silent attempts and reduces
    circuit pressure — additive in the sense I11 means.
26. `getPath(path, { timeout = 20000 } = {})` drops every other option, so the `retries` passthrough
    is genuinely new, and the `retries === undefined` branch keeps all existing callers identical.
27. `ensureBackendRunning`'s poll-timeout path returns `{ok:false, error, diagnosis, detail,
    stderrTail}` with `detail` carrying the URL as a detail and `stderrTail` sliced `-4`; the
    start-failure path returns no `detail`. §3.5(b)'s `detail: gate.detail ?? null` annotation is
    required (see finding 10 for the remedy half).
28. `readOnly` is a plain channel→function map whose loop applies `denyUnless(user, 'stockmind.view')`
    uniformly, and handlers are invoked as `fn(args)` with `user` stripped. Registering
    `market:engine-diagnosis` there does inherit the gate, as §3.5(c) claims.
29. `ALLOWED_PREFIXES` in `preload.cjs` does **not** contain `market:`, and `marketIntel` is an
    explicit named-method object. §3.5(c)'s refusal to widen it is correct and is a real security
    decision, not decoration.
30. `/ohlcv` returns `stored`, `matched`, `count`, `truncated` (`len(bars) < matched`),
    `requestedFrom`/`requestedTo`, `storedFirstBar`/`storedLastBar`, `note`, `meta`, `syncInfo` — all
    of which the renderer currently discards. `truncated` is Rāma's own `limit` trimming the payload,
    exactly as §3.4 and E1 now agree.
31. `fromDate`/`toDate` are applied **after** load/sync with `pd.Timestamp`, and `store.sync(symbol,
    exchange, interval, years=None, force=False)` has no window parameter and is called by the route
    without `force`. The design's premise — the window never reaches the provider — holds.
32. The non-sync branch builds `info` as the literal `{"fromStore": True}` with no `supports`, no
    `source` and no `reason`. §3.2's capability-retention rule and §3.3's `meta.lastSource` precedence
    are both answering a real condition.
33. `store.sync` sets `info['reason']` to `"store is current"` on the no-op branch, `"no provider
    returned data"` on the empty-chain branch, and `"fetched deep history"` / `"topped up"` with
    `fetched: True` after a merge. §3.4's ordered `classifyOutcome` is consistent with all four.
34. `store.merge` writes `lastFetchedAt` as `datetime.now().isoformat(timespec="seconds")` — naive
    **local**, no offset — and `is_stale` compares it against a local `datetime.now()`. §3.3's
    "parsed as local, never suffixed `Z`" is correct and the IST regression pin is the right test.
35. The provenance record holds `bars`/`firstBar`/`lastBar`/`lastSource`/`lastFetchedAt`/`barsAdded`/
    `yearsCovered` — one stamp per store file, no ranges. §3.3's store-level wording and §3.10 item 5
    are both justified.
36. `is_stale`'s intraday branch is a two-bar-width freshness slack plus a `max(5, span)`-minute
    cooldown on `lastFetchedAt`, with one identical `reason` string for both. §3.4's refusal to
    re-derive it and §3.10 item 7's two new fields are the right split.
37. `providers.fetch_history` discards any frame under 20 bars and returns `(None, 'none')`, so a thin
    frame and a dead chain are indistinguishable from the payload. §3.5(d)'s single
    `nothing-upstream` trigger and the deferral of `shortFrame` are correct.
38. `PopoutPanel`'s `Frame` wires `onClick={onRefresh}` and the chart call site passes
    `onRefresh={loadBars}` / `onFetch={loadBars}`. Once `loadBars` takes `doSync`, a React synthetic
    event is truthy — §3.6's explicit wrapping is required, not cosmetic, and inverting it would turn
    the refresh button into a 90-second sync.
39. `react` and `react-dom` are both pinned `19.2.0` and `lightweight-charts` `5.2.1`, with no `^` or
    `~` anywhere in `dependencies`. §3.0's stack lock is accurate and I12's pinning rule is honoured;
    no dependency is added.
40. `verifyGlossary.mjs` enforces exactly the rules §3.12 lists: name + group + short + long present,
    group declared, `short` ≤ 130 and ending in `[.!?]`, `long` longer than `short` and ≤ 700, ≥ 8
    substantive words beyond the term's own name, `seeAlso` resolves, and every term reachable from a
    render site or a `seeAlso`. The `chart` and `instrument` groups both exist.
41. The `verify` chain ends `… verifyChartSessions.mjs && auditRenderer.cjs && verifyInvariants.cjs &&
    verifyLoyaltyTripwire.cjs` — §3.12's insertion point is correct.
42. `verifyEngineDiagnosis.cjs` installs an `electron` stub via `Module._resolveFilename` and
    **restores it immediately** after requiring `aiProcess.cjs`; `marketIntel.cjs`'s module-scope
    requires are only `lib/http.cjs`, `lib/capability.cjs` and `./aiProcess.cjs`, and `capability.cjs`
    needs only a JSON file. §3.12's instruction to hold the stub until after both requires is correct
    and necessary, and the file already uses source-reading assertions on `marketIntel.cjs`.
43. The ledger's last row is **145**, so §3.13's "ledger row 146" is right. I9, I11 and I12 read as
    the design quotes them.
44. The forbidden set — `loyaltyGuard.cjs`, `loyaltyCore.cjs`, `nucleusSealer.cjs`, `proposals.cjs`,
    `capability.cjs`, `genomeApplier.cjs`, `shared/capabilities.json` — plus `chartTime.js`,
    `chartZoom.js`, `timeframes.js`, `chartSessions.js` and all of `ai_backend/` are explicitly listed
    as untouched in §3.13, and nothing in §3.1–§3.9 contradicts that list.
45. No `console.log` is specified anywhere in the new code; the only renderer logging is one
    `console.warn` copying `PriceChart.jsx:743`'s existing shape, and the bridge keeps `console.error`
    only in `catch` blocks that already have it. No `TODO`/`FIXME` appears in the design.
46. The scope boundary holds: every file §3.1–§3.9 names is under `src/pages/StockMind/`,
    `electron/lib/http.cjs`, `electron/ipc/marketIntel.cjs`, `electron/preload.cjs` or `scripts/`, and
    every engine-dependent behaviour is deferred to §3.10 with a named signature or payload field.
47. The five required decisions are each made explicitly and each carries a reason: §3.1 (window
    fetching over lazy paging — store-is-primary, hard rolling caps, no place for a contract, and
    `chartZoom` feedback), §3.2 (gap model — detected from bars, ranges not a span, bands not
    interactive, fill gated), §3.3 (contract before the request, with MT5/IBKR precedent), §3.4
    (two lanes, eight states, a cancel that does not claim to stop the engine, no automatic retry),
    §3.5 (the existing `ensureBackendRunning` / `diagnoseFailure` diagnosis routed onto the canvas,
    never replaced).

---

## Unverified / Wrong Assumptions

**Wrong, and now findings.**

- **W1.** §3.5(d)'s "`failure.error` (reason **and** remedy)" is false for
  `ensureBackendRunning`'s start-failure branch, which supplies `remedy: ''` and never consults
  `diagnoseFailure`. → finding 10.
- **W2.** §3.5(c)'s "reaches no provider and spends no engine time" is false: `ensureBackendRunning`
  spawns the Python process and polls `/health` for up to 8 seconds. → finding 11.
- **W3.** §3.7's "connection refused, socket error, **oversized body** … there is no body" is wrong
  about the oversized case: the cap trips mid-read of a response the engine is sending. → finding 12.
- **W4.** §3.12's claim that `auditRenderer.cjs` is part of this tranche's in-worktree bar is wrong —
  it needs `@babel/parser` from an uninstalled `node_modules`. → finding 13.
- **W5.** §3.2's `enqueueAll` note ("4 of 12 gaps were queued") contradicts E16, §3.15 and §3.12.
  → finding 8.
- **W6.** §3.4's `conflicts()` is incompatible with §3.2/E16/§3.12's multi-window queue. → finding 2.
- **W7.** §3.5(d)'s prop contract is incompatible with its own `emptyState` and `describeFreshness`
  signatures. → finding 5.
- **W8.** §3.5(d)'s `nothing-yet` trigger ("nothing ever stored") contradicts E15's routing of a
  400-bar store to `nothing-yet`. → finding 4.

**Unverifiable here, and correctly called out as deferred by the design** — no finding raised:

- Whether the providers' intraday retention is a rolling window or a maximum width. Recorded in §3.14
  as an assumption with the conservative error named; drives both clamps in §3.1 and §3.10 item 3.
- Whether `/ohlcv` tolerates unknown query parameters — the stated reason the bridge gains only the
  `retries` passthrough this tranche.
- Every §3.10 engine behaviour: `want_from`/`want_to` threading, `info['clamped']`, `shortFrame`,
  per-range `ranges[].fetchedAt`, `supports` on both route branches, `staleCheck` /
  `cooldownRemainingMin`. All specified by signature and payload field, all explicitly deferred, and
  every renderer surface that depends on them is gated or degrades with a stated sentence.
- `limited`'s unreachability until §3.10 item 2, and `asked-absent`'s absence on the default view.
  Both stated as intended outcomes with reasons, so a later session cannot read them as defects.
- The six unmeasured heuristics (`GAP_FACTOR`, `MIN_GAP_BARS`, `HOLIDAY_TOLERANCE_DAYS`,
  `OLDER_PROMPT_BARS`, `MAX_LISTED_GAPS`, `MAX_SHOWN_JOBS`) — named as reasoned starting values with
  the thresholds' *behaviour* pinned by the suite rather than their values.
- Freshness being store-level until §3.10 item 5. The step's *"a fetched window carries its fetch
  time"* is met as far as the payload allows, with the shortfall named rather than approximated.
- `vite build`; fact 24's symptom; the circuit-breaker and mid-fetch-death paths;
  `verifyEngineDiagnosis.cjs`'s 34/34 being carried rather than re-run; `marketIntel.cjs` never having
  been `require`d under plain `node`, with the source-reading fallback stated.

**Unverifiable here and NOT called out** — raised as findings above rather than left in this section:
findings 1, 2, 3, 6, 7, 14, 15, 17, 18 are all decidable from the design and the renderer source, so
none of them is an environment limitation.
