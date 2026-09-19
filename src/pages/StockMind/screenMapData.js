/**
 * screenMapData.js — the callout text for each screen map (spec Section 104).
 *
 * SEPARATE FROM `ScreenMap.jsx` ON PURPOSE. Every callout cites a glossary term, and
 * `scripts/verifyGlossary.mjs` has to check those citations resolve. An earlier version kept this data
 * inside the JSX and the suite scraped it with a regex — which could not distinguish a pin's term id
 * from a column heading inside the SVG, so it simultaneously reported real terms as unreferenced and
 * SVG label strings as broken references.
 *
 * Data that needs checking must not be embedded in something the checker cannot parse. Plain module,
 * no JSX, importable by node.
 *
 * Each pin is `[title, body, termId]`. `termId` may be null for a callout with nothing to link to.
 */

export const SCREEN_DATA = {
  chart: {
    title: 'CHART',
    intro: 'The primary surface. Everything above the plot is arranged the way trading platforms '
      + 'arrange it: what you are looking at, then how much of it, then how it is drawn.',
    pins: [
      ['Identity and last price',
        'Symbol, interval and window, then the last close and the change on the bar. The number you '
        + 'look at first is on the chart rather than in a form above it.',
        'instrument'],
      ['Interval — how much time one bar covers',
        'Grouped by what they are FOR rather than by their unit: minutes for intraday, hours for '
        + 'swing, days and above for long-term context. That is the distinction you are actually '
        + 'making when you reach for the control.',
        'interval'],
      ['Window — how far back to look',
        'Only the depths free data can actually serve for the chosen interval are offered, so a button '
        + 'can never return an empty chart. The buttons change when you change interval.',
        'window'],
      ['Presentation, then evidence layers',
        'Chart type and price scale collapse into one menu whose label shows the current choice. '
        + 'Indicators are arithmetic on the visible bars. The chips on the right toggle what is drawn '
        + 'OVER the price — your own fills, a signal\'s levels, the projection cone.',
        'overlay'],
      ['Legend',
        'The hovered bar\'s values, on the chart rather than below it, so reading a bar does not mean '
        + 'looking away from it and back.',
        'crosshairLegend'],
      ['Levels',
        'A signal\'s entry, stop and targets, plus any stop and target you declared yourself — drawn '
        + 'thicker, because what you committed to is the stronger statement about your intent.',
        'levels'],
      ['Volume, in its own pane',
        'Separate from price, so price keeps the full height of its own pane. Indicators on their own '
        + 'scale, like RSI, get a pane each for the same reason — a 0-to-100 series cannot share an '
        + 'axis with a 24,000-point index.',
        'volumePane'],
      ['Status strip and keyboard',
        'The same values repeated in text, because a canvas is not readable by assistive technology. '
        + 'Keys work once the chart has focus: 1–5 chart type, L log scale, R reset zoom, F fullscreen.',
        'fitZoom'],
    ],
  },

  signals: {
    title: 'SIGNALS',
    intro: 'One reading of one instrument, requested on demand. The rows are not competing forecasts.',
    pins: [
      ['Data source, stated first',
        'REAL OHLCV or MOCK DATA. Never act on anything on this screen while it says mock. SUPPRESSED '
        + 'counts setups Rāma computed and declined to recommend, shown rather than hidden.',
        'mockData'],
      ['Ten columns, each with its own definition',
        'Entry, stop and the three targets are price levels. R:R is reward over risk. PROB is the '
        + 'modelled chance of reaching the first target. GRADE is the engine\'s own confidence band, '
        + 'and it is a summary of the other columns rather than extra information.',
        'riskReward'],
      ['One prediction, several geometries',
        'Three rows means three ways of placing stop and targets around the same view — a tighter stop '
        + 'with a nearer target, or a wider one. Choosing a row puts its levels on the chart, and the '
        + 'button beside this line takes you there.',
        'setup'],
      ['WHY — the numbers behind the row',
        'Direction before geometry, the risk of being stopped first, how much the models agreed, and '
        + 'the provenance of the probability. Read SL RISK next to PROB: 62% at the first target with '
        + 'a 39% chance of being stopped first is not what 62% alone suggests.',
        'slProbability'],
    ],
  },

  book: {
    title: 'YOUR BOOK',
    intro: 'What you actually hold. Rāma does not connect to a broker — you record the trades, and in '
      + 'exchange it watches your stops, your holding periods and your concentration, and marks your '
      + 'fills on the chart.',
    pins: [
      ['Warnings Rāma will act on',
        'Facts, not predictions: a stop breached, a holding period exceeded, a concentration building. '
        + 'These depend on no model being validated, which is why they stay live when model readings '
        + 'are withheld.',
        'actionableAlert'],
      ['Readings it will not act on',
        'Collapsed behind a count, with the reason. A real stop breach is never sitting next to a '
        + 'speculative model note as though they were the same kind of statement.',
        'withheldAlert'],
      ['Positions, marked against stored prices',
        'Not a live feed. A stale price is flagged amber, because every profit figure derived from it '
        + 'is stale too. A negative quantity means a short, and its profit runs the other way.',
        'priceStale'],
      ['Trade style drives the warnings',
        'An INTRADAY position showing 6 days is the expensive mistake this column exists to surface. '
        + '"(assumed)" means Rāma guessed because the position predates the field, and the warnings '
        + 'are calibrated for the wrong holding period until you correct it.',
        'tradeStyle'],
      ['The exit form shows the consequence first',
        'What this exit realises net of fees, what stays open, and how the price sits against the stop '
        + 'you recorded — all before anything is written. It replaced a native prompt that accepted '
        + 'any string and showed nothing.',
        'partialExit'],
    ],
  },

  strategy: {
    title: 'STRATEGY',
    intro: 'A rule you could have followed for years, rather than a reading of today. Built by picking '
      + 'blocks, judged against history the search was never allowed to see.',
    pins: [
      ['Blocks, grouped by what they are evidence OF',
        'Trend structure, moving averages, momentum, volatility, breakout, session. The two groups '
        + 'marked ⚠ can run in a live strategy but cannot honestly be backtested, and the reason is '
        + 'printed on the screen rather than hidden behind a hover.',
        'block'],
      ['Parameters, and optionally a sweep',
        'A sweep tries several values for one parameter. You type comma-separated values — it is '
        + 'deliberately not a from/to/step control, because every sweep multiplies the variant count '
        + 'and that should be a decision rather than a side effect.',
        'sweep'],
      ['Exit and money',
        'At least one exit rule is required: without a stop, a target or a bar limit, every trade runs '
        + 'to the end of the data and the result describes the instrument rather than the strategy. '
        + 'There is no target-return field, on purpose.',
        'stopPctBlock'],
      ['The variant count, BEFORE you run',
        'The most important number on the screen. Search enough variants and one will look excellent '
        + 'whether or not an edge exists, so Rāma raises the bar in proportion — and shows the count '
        + 'while it is still a decision rather than afterwards when it is useless.',
        'trials'],
      ['The verdict, ahead of any return figure',
        'A strategy that made 40% on the search window and failed the holdout has failed. The currency '
        + 'figures appear below the verdict, never above it, and the generated Python carries the '
        + 'verdict in its header so the file can never look like an endorsement it did not earn.',
        'deflated'],
    ],
  },
};

export const SCREEN_ORDER = Object.keys(SCREEN_DATA);

/** Every glossary term id cited by any callout, so the suite can check them without a regex. */
export function citedTermIds() {
  const out = new Set();
  for (const screen of Object.values(SCREEN_DATA)) {
    for (const pin of screen.pins) {
      if (pin[2]) out.add(pin[2]);
    }
  }
  return [...out];
}
