
/**
 * verifyChartEmptyState.mjs — the four sentences an empty chart is allowed to say (Section 126).
 *
 * WHAT THIS SUBSYSTEM IS FOR. A chart with no candles has to explain itself, and for three releases it
 * explained itself wrongly in three different ways. The explanation now comes from `emptyState()`,
 * which is pure, so the wrongness is assertable here rather than only visible on master's screen.
 *
 * The assertions that matter most:
 *   - 400 BARS STORED AND NONE IN THE WINDOW IS NOT "NOTHING STORED". The old headline said
 *     "No 30m bars stored for NIFTY50." with 400 on disk. That sentence must now be unreachable
 *     whenever `coverage.stored > 0`, and the headline must be the ROUTE'S OWN note, verbatim.
 *   - THE ACTION MUST BE FOLLOWABLE. `nothing-in-window` must never offer a fetch: fetching cannot move
 *     bars into a window the provider does not serve, which is the defect the state exists to end.
 *   - AND NEITHER MAY THE LINE UNDER THE HEADLINE. Fixing the headline moved the falsehood one line
 *     down: the detail read `stored <first> → now` because the route omits `storedLastBar` on exactly
 *     the branch this state is reached through. An unknown end is now left unsaid, and the assertions
 *     require that it is not rendered as `now`, as a date, or as an empty arrow.
 *   - A NAMED CAUSE OUTRANKS A GENERIC ABSENCE. Master's Python engine has never completed a run, so
 *     `failed` is the state he is actually in; every failure mode must carry a reason, and a remedy must
 *     reach the screen whether the bridge folded it into `error` or left it on `diagnosis`.
 *   - NO INVENTED CAUSES. With no note, no error and no diagnosis the module states the fact and stops.
 *   - The Section 107 headline is unchanged for the case it was always true of.
 *   - Junk returns something renderable rather than throwing. This runs inside a render.
 *
 * Run: node scripts/verifyChartEmptyState.mjs   (or npm run verify:empty-state)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { emptyState } from '../src/pages/StockMind/chartEmptyState.js';
import { describeLimit } from '../src/pages/StockMind/timeframes.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SM = path.join(ROOT, 'src', 'pages', 'StockMind');

let pass = 0;
let fail = 0;
const check = (label, ok, detail) => {
  if (ok) { pass += 1; console.log(`  PASS  ${label}`); }
  else { fail += 1; console.log(`  FAIL  ${label}${detail !== undefined ? ` - ${detail}` : ''}`); }
};
const read = (f) => {
  try { return fs.readFileSync(f, 'utf8'); } catch { return ''; }
};

// ── Fixtures ──────────────────────────────────────────────────────────────────
//
// `ROUTE_NOTE` is the sentence `ai_backend/main.py` sends on the matched == 0 branch, copied here with
// its wording intact. If the route's wording changes this suite does not care — nothing below matches
// on its words, only on the module using it verbatim — but having it here states what arrives.
const ROUTE_NOTE = '400 30m bars are stored, but none fall between 2024-01-01 and 2024-02-01. '
  + 'Widen the dates, or fetch more history.';

// The gate object `ensureBackendRunning` returns, as the bridge passes it through.
const GATE = {
  error: "StockMind's engine is not running: the engine's Python packages are not installed "
    + "('fastapi'). Run Rama.bat option 3 to create the engine environment.",
  diagnosis: {
    reason: "the engine's Python packages are not installed ('fastapi')",
    remedy: 'Run Rama.bat option 3 to create the engine environment.',
  },
  detail: 'no answer from http://127.0.0.1:8001 after 8s: ECONNREFUSED · interpreter python',
  stderrTail: ["ModuleNotFoundError: No module named 'fastapi'"],
};

console.log('\nchart empty state — the sentence has to be true\n');

// ── 1. Candles on screen: there is nothing to say ─────────────────────────────
console.log('  with candles on the canvas the overlay is not rendered at all');
check('one bar is enough to return null', emptyState({ bars: 1 }) === null);
check('and a failure does not resurrect the overlay over drawn candles',
  emptyState({ bars: 240, failure: GATE }) === null);

// ── 2. A fetch in flight ──────────────────────────────────────────────────────
console.log('\n  a fetch in flight is reported as one, not as advice to start one');
{
  const s = emptyState({ bars: 0, busy: true, interval: '30m', symbol: 'NIFTY50' });
  check('the kind is fetching', s.kind === 'fetching', s.kind);
  check('the symbol and the interval label are both named',
    /NIFTY50/.test(s.headline) && /30m|30 min/i.test(s.headline), s.headline);
  check('no action is offered while it runs', s.action === null);
  check('busy outranks a stale failure from the previous attempt',
    emptyState({ bars: 0, busy: true, failure: GATE }).kind === 'fetching');
}

// ── 3. THE HEADLINE DEFECT: bars are stored, the window is wrong ──────────────
console.log('\n  400 BARS STORED AND NONE IN THE WINDOW IS NOT "NOTHING STORED"');
{
  const s = emptyState({
    bars: 0,
    note: ROUTE_NOTE,
    coverage: { first: '2019-04-01', last: '2019-06-28', stored: 400 },
    interval: '30m',
    symbol: 'NIFTY50',
    rangeId: '1Y',
  });
  check('the kind is nothing-in-window', s.kind === 'nothing-in-window', s.kind);
  check('THE FALSE SENTENCE IS GONE — no "No 30m bars stored for NIFTY50"',
    !/No .* bars stored for/.test(s.headline), s.headline);
  check('the headline IS the route\'s own note, character for character',
    s.headline === ROUTE_NOTE, s.headline);
  check('and it is marked as not composed here, so a reviewer can tell whose sentence it is',
    s.composed === false);
  check('THE UNFOLLOWABLE ACTION IS GONE — no fetch button',
    s.action?.id !== 'fetch', JSON.stringify(s.action));
  check('the action is the one that can actually help: clearing the dates',
    s.action?.id === 'clear-dates', JSON.stringify(s.action));
  check('the window that DOES exist is stated, so master can aim at it',
    s.detail === 'stored 2019-04-01 → 2019-06-28', s.detail);
  check('the provider-limit hint is not added — the limit is not why this is empty',
    s.hint === null, s.hint);
  check('one stored bar is enough to reach this state, not an arbitrary floor',
    emptyState({ bars: 0, coverage: { stored: 1 }, note: 'x' }).kind === 'nothing-in-window');
}

console.log('\n  and with no note on the reply it states the fact without inventing a cause');
{
  const s = emptyState({
    bars: 0,
    note: null,
    coverage: { first: '2019-04-01', last: null, stored: 400 },
    interval: '30m',
    symbol: 'NIFTY50',
  });
  check('still nothing-in-window', s.kind === 'nothing-in-window', s.kind);
  check('the count and the window are both named', /400/.test(s.headline)
    && /selected dates/.test(s.headline), s.headline);
  check('it claims no cause — no "widen", no "provider", no "fetch"',
    !/widen|provider|fetch/i.test(s.headline), s.headline);
  check('it is marked as composed by the renderer', s.composed === true);
  check('an empty note string is treated as absent, not printed as a blank headline',
    emptyState({ bars: 0, note: '   ', coverage: { stored: 5 } }).composed === true);
}

// THE DETAIL LINE MUST NOT CLAIM AN END THE REPLY DID NOT CARRY. `ai_backend/main.py` sends
// `storedLastBar` on the success branch and NOT on the matched == 0 branch — which is the only branch
// this state is reached through — so `coverage.last` is null in every real instance of it. The line read
// `stored ${first} → ${last || 'now'}` and so printed `stored 2019-04-01 → now` under a headline saying
// nothing falls in a 2024 window. Both cannot be true. The unknown end is now left unsaid.
console.log('\n  and the stored window is stated only as far as the reply said it');
{
  const real = emptyState({
    bars: 0,
    note: ROUTE_NOTE,
    coverage: { first: '2019-04-01', last: null, stored: 400 },
  });
  check('with no storedLastBar the end is NOT rendered as "now"',
    !/now/.test(real.detail || ''), real.detail);
  check('nor invented as a date — no second date appears at all',
    ((real.detail || '').match(/\d{4}-\d{2}-\d{2}/g) || []).length === 1, real.detail);
  check('nor printed as undefined, null or an empty arrow',
    !/undefined|null|→\s*$/.test(real.detail || ''), real.detail);
  check('what IS known is still stated: the start the reply carried',
    real.detail === 'stored from 2019-04-01', real.detail);
  check('and the detail never outlives the headline it sits under — one claim, one date',
    /2019-04-01/.test(real.detail) && !/2024/.test(real.detail), real.detail);
  check('an end that IS carried is rendered, with the arrow',
    emptyState({ bars: 0, coverage: { first: '2019-04-01', last: '2019-06-28', stored: 400 } }).detail
      === 'stored 2019-04-01 → 2019-06-28');
  check('a blank storedLastBar string counts as absent, not as an end',
    emptyState({ bars: 0, coverage: { first: '2019-04-01', last: '   ', stored: 400 } }).detail
      === 'stored from 2019-04-01');
  check('a non-string first is not rendered as a window at all',
    emptyState({ bars: 0, coverage: { first: 17, last: '2019-06-28', stored: 400 } }).detail === null);
  check('and with neither end known there is no detail line to be wrong',
    emptyState({ bars: 0, coverage: { stored: 400 } }).detail === null);
}

// ── 4. A NAMED CAUSE OUTRANKS A GENERIC ABSENCE ───────────────────────────────
console.log('\n  the engine is down: the reason AND the remedy reach the canvas');
{
  const s = emptyState({ bars: 0, failure: GATE, interval: '30m', symbol: 'NIFTY50' });
  check('the kind is failed', s.kind === 'failed', s.kind);
  check('the bridge\'s sentence is used verbatim', s.headline === GATE.error, s.headline);
  check('the reason is on screen', /packages are not installed/.test(s.headline));
  check('the remedy is on screen', /option 3/.test(s.headline));
  check('and it is not printed twice — the bridge already folded it into the sentence',
    s.remedy === null, s.remedy);
  check('the store is not blamed for the engine', !/bars stored/.test(s.headline), s.headline);
  check('the knocked URL survives as a detail, never as the headline',
    s.detail === GATE.detail && !/127\.0\.0\.1/.test(s.headline));
  check('the engine\'s last lines travel with it', s.tail.length === 1
    && /ModuleNotFoundError/.test(s.tail[0]));
  check('a retry is offered, because some failures are transient',
    s.action?.id === 'fetch', JSON.stringify(s.action));
  check('a failure outranks what the store happens to hold',
    emptyState({ bars: 0, failure: GATE, coverage: { stored: 400 }, note: ROUTE_NOTE }).kind
      === 'failed');
}

console.log('\n  every failure mode, not only the diagnosed one');
{
  // A route-level failure: the engine answered, the request still failed, so there is no gate object
  // and no remedy folded into the message.
  const route = emptyState({ bars: 0, failure: { error: 'HTTP 500 from /ohlcv/NIFTY50' } });
  check('a route-level error is still a named failure', route.kind === 'failed'
    && route.headline === 'HTTP 500 from /ohlcv/NIFTY50', route.headline);
  check('and it does not pretend to a remedy it was not given', route.remedy === null);
  check('nor to engine output it was not given', route.tail.length === 0);

  // A diagnosis with no composed sentence: the remedy must still be surfaced, separately.
  const bare = emptyState({ bars: 0, failure: { diagnosis: GATE.diagnosis } });
  check('a diagnosis without an error string still yields a reason', bare.kind === 'failed'
    && /packages are not installed/.test(bare.headline), bare.headline);
  check('and the remedy reaches the screen with it, composed onto the reason',
    bare.headline.includes(GATE.diagnosis.remedy), bare.headline);
  check('exactly once — the separate field stays null when the headline already carries it',
    bare.remedy === null, bare.remedy);
  // The field exists for the mode where the two cannot be composed: a message that is not the
  // bridge's own sentence, with a remedy beside it. Without this the remedy would never be printed.
  const split = emptyState({
    bars: 0,
    failure: { error: 'could not load bars', diagnosis: { remedy: 'Run Rama.bat option 3.' } },
  });
  check('a message with no remedy in it gets the remedy as its own line',
    split.headline === 'could not load bars' && split.remedy === 'Run Rama.bat option 3.',
    `${split.headline} / ${split.remedy}`);
  check('the composed sentence is punctuated once, not twice',
    !/\.\./.test(bare.headline), bare.headline);

  // Nothing but a truthy failure. The honest answer is that the reply carried no reason.
  const nothing = emptyState({ bars: 0, failure: {} });
  check('an empty failure object does not throw', nothing.kind === 'failed');
  check('and says the reply carried no reason rather than naming one',
    /no reason/.test(nothing.headline), nothing.headline);

  // The four modes verifyEngineDiagnosis.cjs distinguishes all arrive here the same way, as a reason
  // plus a remedy on `diagnosis`. Asserted as a set so a new mode cannot be dropped silently.
  const modes = [
    { reason: 'port 8001 is already in use', remedy: 'Set STOCKMIND_PORT and restart.' },
    { reason: 'the engine could not be parsed by this Python', remedy: 'Run Rama.bat option 2.' },
    { reason: 'the engine is running but has not answered yet', remedy: 'Wait and retry.' },
    { reason: 'the engine exited with code 9009', remedy: 'Set RAMA_PYTHON.' },
  ];
  check('all four engine failure modes produce a reason and a remedy on the canvas',
    modes.every((d) => {
      const s = emptyState({ bars: 0, failure: { diagnosis: d } });
      return s.kind === 'failed' && s.headline.includes(d.reason)
        && (s.headline.includes(d.remedy) || s.remedy === d.remedy);
    }));
  check('and none of them is reported as an empty store',
    modes.every((d) => !/bars stored/.test(emptyState({ bars: 0, failure: { diagnosis: d } }).headline)));
}

// ── 5. NOTHING YET — the one case the old sentence was true of ────────────────
console.log('\n  nothing stored at all: the Section 107 sentence, unchanged');
{
  const s = emptyState({ bars: 0, interval: '30m', symbol: 'NIFTY50', rangeId: '1Y' });
  check('the kind is nothing-yet', s.kind === 'nothing-yet', s.kind);
  check('the headline is the sentence that was always correct here',
    s.headline === 'No 30m bars stored for NIFTY50 over 1Y.', s.headline);
  check('the fetch is offered, and here it can actually help',
    s.action?.id === 'fetch' && /Fetch & store/.test(s.action.label), JSON.stringify(s.action));
  check('the provider limit is named, so a missing window reads as a cap not a refusal',
    s.hint === describeLimit('30m'), s.hint);
  check('with no range selected the "over" clause is omitted',
    emptyState({ bars: 0, interval: '30m', symbol: 'NIFTY50' }).headline
      === 'No 30m bars stored for NIFTY50.');
  check('with no symbol it says "this symbol" rather than printing nothing',
    /this symbol/.test(emptyState({ bars: 0, interval: '1d' }).headline));
  check('stored: 0 is nothing-yet, not nothing-in-window',
    emptyState({ bars: 0, coverage: { stored: 0 } }).kind === 'nothing-yet');
  check('a coverage object with no stored count is treated as nothing-yet',
    emptyState({ bars: 0, coverage: { first: '2019-04-01' } }).kind === 'nothing-yet');
  check('a daily interval has no cap, so there is no hint to print',
    emptyState({ bars: 0, interval: '1d', symbol: 'X' }).hint === null);
}

// ── 6. It runs inside a render, so it may not throw ───────────────────────────
console.log('\n  junk in, a renderable object out');
check('called with nothing at all it does not throw', emptyState().kind === 'nothing-yet');
check('an unknown interval falls back to the id rather than printing undefined',
  /zzz/.test(emptyState({ bars: 0, interval: 'zzz', symbol: 'X' }).headline));
check('a non-array stderrTail becomes an empty array',
  Array.isArray(emptyState({ bars: 0, failure: { error: 'x', stderrTail: 'oops' } }).tail));
check('a non-string line inside the tail is dropped rather than rendered as [object Object]',
  emptyState({ bars: 0, failure: { error: 'x', stderrTail: ['ok', { a: 1 }, null] } }).tail.length
    === 1);
check('every state carries the full shape, so the renderer needs no optional chaining on it',
  [
    emptyState({ bars: 0, busy: true }),
    emptyState({ bars: 0, failure: GATE }),
    emptyState({ bars: 0, coverage: { stored: 9 } }),
    emptyState({ bars: 0 }),
  ].every((s) => ['kind', 'headline', 'composed', 'remedy', 'detail', 'hint', 'tail', 'action']
    .every((k) => k in s)));
check('a headline is never empty, in any state',
  [
    emptyState({ bars: 0, busy: true }),
    emptyState({ bars: 0, failure: {} }),
    emptyState({ bars: 0, coverage: { stored: 9 } }),
    emptyState({ bars: 0 }),
  ].every((s) => typeof s.headline === 'string' && s.headline.trim().length > 0));

// ── 7. ITEM 1: the props reach ALL THREE call sites ───────────────────────────
//
// Source-level, because a prop that is threaded to two of three charts is exactly the defect found in
// review, and no behavioural test of a pure function can see a missing attribute in JSX.
//
// DISCOVERED, NOT COUNTED. The first version of this block summed `<PriceChart` matches across two
// hardcoded files and required the total to be 3 — so a FOURTH chart introduced in a third file left the
// suite green while reintroducing the one-of-three defect the tranche exists to fix. Every `.jsx` under
// src/pages/StockMind is scanned, every call site found is required to carry all three props, and the
// patterns match ATTRIBUTE NAMES rather than whole expressions, so wrapping an attribute across lines
// no longer turns a green suite red.
console.log('\n  the reply reaches every chart, however many there are');
{
  const chart = read(path.join(SM, 'PriceChart.jsx'));
  const stock = read(path.join(SM, 'StockMind.jsx'));
  const popout = read(path.join(SM, 'PopoutPanel.jsx'));
  const pkg = read(path.join(ROOT, 'package.json'));

  // One element's source, from `<PriceChart` to the `/>` that closes it. Every call site in this
  // codebase is self-closing; a non-self-closing one would be caught by the per-site prop assertions
  // below reading past its own tag, which fails loudly rather than passing quietly.
  const callSites = fs.readdirSync(SM)
    .filter((f) => f.endsWith('.jsx'))
    .flatMap((f) => {
      const src = read(path.join(SM, f));
      const out = [];
      let at = src.indexOf('<PriceChart');
      while (at !== -1) {
        const end = src.indexOf('/>', at);
        out.push({ file: f, src: src.slice(at, end === -1 ? src.length : end) });
        at = src.indexOf('<PriceChart', at + 1);
      }
      return out;
    });

  check('the call sites are found by scanning, not assumed — at least the three that exist',
    callSites.length >= 3, String(callSites.length));
  check('and they are spread across more than one file, so the scan is not reading one of them twice',
    new Set(callSites.map((c) => c.file)).size >= 2,
    [...new Set(callSites.map((c) => c.file))].join(', '));
  for (const attr of ['coverage', 'replyNote', 'failure']) {
    const missing = callSites.filter((c) => !new RegExp(`\\b${attr}=\\{`).test(c.src));
    check(`EVERY call site is handed \`${attr}\` — one of three was the defect`,
      missing.length === 0, missing.map((c) => c.file).join(', '));
  }
  check('PriceChart takes replyNote and failure, both optional and both defaulting to null (I11)',
    /\n  replyNote = null,/.test(chart) && /\n  failure = null,/.test(chart));
  // It is `replyNote` and not `note` because `note` is this component's inline note-editor state, and
  // the shadow is a parse error auditRenderer.cjs rejects. Asserted so the shorter name cannot return.
  check('and it is not called `note`, which would shadow the note editor\'s state',
    !/\n  note = null,/.test(chart) && /const \[note, setNote\] = useState\(null\)/.test(chart));
  check('and coverage still defaults to null, so an unaware call site keeps working',
    /\n  coverage = null,/.test(chart));
  check('meta and syncInfo were NOT invented as props — the route sends them, nothing reads them',
    !/\n  meta = null,/.test(chart) && !/\n  syncInfo = null,/.test(chart));
  check('StockMind builds ONE coverage object for both of its charts',
    /const coverage = useMemo/.test(stock)
      && (stock.match(/coverage=\{coverage\}/g) || []).length
        === (stock.match(/<PriceChart/g) || []).length,
    String((stock.match(/coverage=\{coverage\}/g) || []).length));
  check('and it carries stored, which is what separates the two empty states',
    /stored: Number\.isFinite\(barsMeta\.stored\)/.test(stock));
  check('the failed reply is kept whole rather than reduced to a string',
    /setBarsFail\(\{/.test(stock) && /diagnosis: res\.diagnosis \|\| null/.test(stock));
  check('and it is cleared when a fetch starts, so a stale failure cannot outlive it',
    /setBarsFail\(null\)/.test(stock));
  check('the pop-out keeps the diagnosis as well as the message',
    /diagnosis: res\?\.diagnosis \|\| null/.test(popout));
  check('and its catch branch produces a failure too, so a thrown error is not a silent empty chart',
    /setFail\(\{ error: err\.message/.test(popout));

  // ONE REPORT OF ONE FAILURE. Both pages keep a message band ABOVE the canvas that predates the
  // overlay, and both set it from the same failed reply the overlay now renders. Ungated, master saw the
  // reason, the collapsed `engine output` and the knocked URL twice over — once in the band and once in
  // the overlay beneath it. The band is gated on drawn candles in both files, because the only case the
  // overlay cannot cover is a message arriving while the PREVIOUS fetch's candles are still on screen.
  check('the pop-out band only shows over drawn candles, so it cannot double the overlay',
    /\{error && bars\.length > 0 && \(/.test(popout));
  check('and StockMind gates its band the same way — the two files must not be asymmetric',
    /\{barsNote && bars\.length > 0 && \(/.test(stock));

  // The pop-out passes `onFetch` and no `onDates`, and PriceChart gates the clear-dates button on
  // `onDates` — so a `nothing-in-window` state there would print "widen the dates" with no control to
  // widen them. It cannot arise today because the pop-out sends NO dates at all, so `/ohlcv` never takes
  // its matched == 0 branch. That is asserted rather than assumed: threading dates into the pop-out must
  // fail this suite, so whoever does it supplies the action first.
  const popoutSite = callSites.find((c) => c.file === 'PopoutPanel.jsx');
  check('the pop-out chart is found as a call site at all', Boolean(popoutSite));
  check('it sends no dates, so the nothing-in-window state cannot arise without an action',
    popoutSite && !/\b(fromDate|toDate)=\{/.test(popoutSite.src), popoutSite?.src);
  check('and the request it makes carries no dates either',
    /limitForDates\(interval, null, null\)/.test(popout));
  check('whereas a call site that DOES send dates also sends the handler that can change them',
    callSites.filter((c) => /\bfromDate=\{/.test(c.src))
      .every((c) => /\bonDates=\{/.test(c.src)));
  check('and the clear-dates button is gated on that handler rather than assuming it',
    /vacancy\.action\?\.id === 'clear-dates' && onDates/.test(chart));

  // The overlay itself: the renderer must read the decided state rather than re-deciding it.
  check('the overlay renders from emptyState() and composes no headline of its own',
    /const vacancy = useMemo\(\(\) => emptyState\(\{/.test(chart)
      && !/No \{intervalDef\(interval\)\?\.label/.test(chart));
  check('the clear-dates action is bound to the existing onDates handler',
    /onDates\('', ''\)/.test(chart));
  check('the fetch action is bound only when a fetch handler exists',
    /vacancy\.action\?\.id === 'fetch' && onFetch/.test(chart));
  check('the engine output is shown on the canvas, collapsed',
    /vacancy\.tail\.length > 0/.test(chart));
  check('no console.log was added to the chart or the module (I12)',
    !/console\.log/.test(chart) && !/console\.log/.test(read(path.join(SM, 'chartEmptyState.js'))));
  check('package.json has a verify:empty-state script',
    /"verify:empty-state": "node scripts\/verifyChartEmptyState\.mjs"/.test(pkg));
  check('and the verify chain runs it after the sessions suite, appended not reordered',
    /verifyChartSessions\.mjs && node scripts\/verifyChartEmptyState\.mjs/.test(pkg));
  check('no dependency was added and nothing is range-pinned',
    /"lightweight-charts": "5\.2\.1"/.test(pkg) && !/[\^~]\d/.test(pkg));
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
