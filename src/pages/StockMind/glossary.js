/**
 * glossary.js — one definition per term, used by the tooltips AND by the help screen.
 *
 * WHY ONE SOURCE (spec Section 104). Master asked whether StockMind explains every field well enough
 * for a user to understand it. The honest answer was no: about a third of the fields carried a `title`
 * attribute, the rest carried none, and several of the most consequential — `UNCERTAINTY 0.031`,
 * `AGREEMENT 0.82`, `contract aligned`, `ABSORBED ENGINE` — were jargon with no statement of what they
 * mean or what to do about them.
 *
 * The obvious fix is to add `title` attributes everywhere. That fails for two reasons. A tooltip is
 * invisible until hovered, so it cannot answer "what is this screen for"; and hand-written tooltips
 * scattered across five files drift from each other until the same term means two things in two
 * places. So every term is defined once here, the `?` affordances read `short`, the help screen reads
 * `long`, and `scripts/verifyGlossary.mjs` fails the suite if a component references a term that does
 * not exist or if a term is defined and never used.
 *
 * `short` is one sentence, for a popover. `long` says what it means, and where it matters, what to DO
 * with it — a definition that leaves master no better able to act is a dictionary entry, not help.
 */

export const GROUPS = [
  { id: 'concepts',   label: 'The ideas behind it' },
  { id: 'instrument', label: 'Instrument and data' },
  { id: 'chart',      label: 'The chart' },
  { id: 'overlays',   label: 'Indicators' },
  { id: 'signals',    label: 'Signals' },
  { id: 'sizing',     label: 'Capital and risk' },
  { id: 'book',       label: 'Your book' },
  { id: 'strategy',   label: 'Strategy builder' },
  { id: 'judgement',  label: 'How a strategy is judged' },
  { id: 'engine',     label: 'Engine and models' },
  { id: 'derivs',     label: 'Derivatives' },
  { id: 'news',       label: 'News' },
];

/**
 * @type {Record<string, {term: string, group: string, short: string, long: string, seeAlso?: string[]}>}
 */
export const TERMS = {
  // ── The ideas ──────────────────────────────────────────────────────────────
  signal: {
    term: 'Signal', group: 'concepts',
    short: 'One reading of one instrument, right now, with the levels to act on it.',
    long: 'A signal is a single answer to "if I took a position here, where would entry, stop and '
      + 'targets sit". It is produced on request and never in the background, because an entry price '
      + 'computed an hour ago is worse than none. Several rows for one symbol are different risk '
      + 'geometries over ONE prediction — not several independent forecasts.',
    seeAlso: ['strategy', 'grade'],
  },
  strategy: {
    term: 'Strategy', group: 'concepts',
    short: 'A rule, tested over history, that says when to enter and exit.',
    long: 'Where a signal is one reading now, a strategy is a rule you could have followed for years. '
      + 'You build one by picking blocks in the STRATEGY tab, Rāma tests it over stored bars, and the '
      + 'verdict says whether the result is distinguishable from luck.',
    seeAlso: ['signal', 'block', 'backtest'],
  },
  backtest: {
    term: 'Backtest', group: 'concepts',
    short: 'Running a rule over past bars to see what it would have done.',
    long: 'Useful and easy to fool yourself with. The three things that make a backtest honest are '
      + 'here by default: trading costs are always applied, entry is on the bar AFTER the signal, and '
      + 'the final slice of history is withheld from the search entirely.',
    seeAlso: ['holdout', 'trials', 'costDrag'],
  },
  edge: {
    term: 'Edge', group: 'concepts',
    short: 'A real, repeatable advantage — as opposed to a lucky run.',
    long: 'The whole difficulty in this field is that luck and edge look identical in a backtest. A '
      + 'result is only called an edge here when it beats what searching that many variants would '
      + 'have produced from pure noise.',
    seeAlso: ['noiseBenchmark', 'deflated'],
  },
  mockData: {
    term: 'Mock data', group: 'concepts',
    short: 'Simulated bars. Anything computed from them is illustrative only.',
    long: 'When no real history is stored and none can be fetched, the engine falls back to generated '
      + 'bars so the screen is not empty — and labels everything MOCK DATA. Never act on a number '
      + 'carrying that badge; fetch real history first.',
    seeAlso: ['fetchProvider'],
  },

  // ── Instrument and data ───────────────────────────────────────────────────
  instrument: {
    term: 'Instrument', group: 'instrument',
    short: 'What you are looking at — a stock, index, ETF, currency, commodity or crypto.',
    long: 'Pick from the dropdown, or type in the filter to search any market. A ● marks an instrument '
      + 'Rāma already has bars for, which draws with no network call. Picking a search result also '
      + 'sets the exchange, because the exchange is a property of the instrument.',
    seeAlso: ['exchange', 'storedLocally'],
  },
  exchange: {
    term: 'Exchange', group: 'instrument',
    short: 'Which market the instrument trades on. Set automatically when you pick one.',
    long: 'It decides how the ticker is looked up: NSE appends .NS, BSE appends .BO, and US exchanges '
      + 'take the ticker bare. Change it by hand only to override where an unlisted ticker should be '
      + 'found.',
    seeAlso: ['instrument'],
  },
  interval: {
    term: 'Interval', group: 'instrument',
    short: 'How much time one bar covers — one minute through one month.',
    long: 'The interval decides what question you are asking. Minute bars answer "what is happening '
      + 'this session"; daily and weekly bars answer "what is this instrument doing this year". The '
      + 'two need different stops, different horizons and different patience.',
    seeAlso: ['window', 'providerCap'],
  },
  window: {
    term: 'Window', group: 'instrument',
    short: 'How far back to look. Only the depths the data provider can actually serve are offered.',
    long: 'Interval and window are a pair — "5-minute bars over one month" is a request; "5-minute '
      + 'bars" alone is not. Free data is capped per interval, so the buttons change when you change '
      + 'interval rather than offering a depth that would come back empty.',
    seeAlso: ['interval', 'providerCap'],
  },
  providerCap: {
    term: 'Provider limit', group: 'instrument',
    short: 'The deepest history free data gives for this interval. Rāma is not the limit.',
    long: 'Measured, not guessed: about 5 days of 1-minute bars, one month of 5 to 30-minute bars, two '
      + 'years of hourly, and everything available for daily and coarser. Asking beyond it returns an '
      + 'error that looks like an empty symbol, which is why the deeper windows are simply not offered.',
    seeAlso: ['window'],
  },
  bars: {
    term: 'Bars', group: 'instrument',
    short: 'One bar is one interval of trading: its open, high, low, close and volume.',
    long: 'Everything on this screen is computed from bars. More bars means a longer history, not more '
      + 'detail — for more detail you need a finer interval.',
    seeAlso: ['interval', 'barsOverride'],
  },
  barsOverride: {
    term: 'Bars (override)', group: 'instrument',
    short: 'The exact bar count to request. The window buttons set it; you can type over them.',
    long: 'An expert control. The window buttons on the chart fill it in for you, and typing a number '
      + 'here asks for exactly that many. It is clamped to the provider limit, so a large number '
      + 'cannot turn into a failed request.',
    seeAlso: ['window', 'providerCap'],
  },
  storedLocally: {
    term: 'Stored locally', group: 'instrument',
    short: 'Rāma already holds these bars on this machine. No network needed.',
    long: 'History is kept on disk once fetched, so it is available offline and the store only ever '
      + 'grows. The ● marker in the instrument list and the "n stored from <date>" line above the '
      + 'chart both refer to this.',
    seeAlso: ['fromDisk', 'fetchProvider'],
  },
  fromDisk: {
    term: 'From disk', group: 'instrument',
    short: 'Re-read what is already stored. Touches no network.',
    long: 'Fast and always safe. Use it after changing interval or window when you know the history is '
      + 'already there.',
    seeAlso: ['fetchProvider'],
  },
  fetchProvider: {
    term: 'Fetch from provider', group: 'instrument',
    short: 'Ask the data providers for anything missing and store it.',
    long: 'Reaches the network and can take a while on a first fetch, because it pulls as deep a '
      + 'history as the provider allows. Everything it retrieves is merged into the local store — it '
      + 'never replaces or shrinks what is already there.',
    seeAlso: ['fromDisk', 'providerCap'],
  },

  // ── The chart ─────────────────────────────────────────────────────────────
  candles: {
    term: 'Candlesticks', group: 'chart',
    short: 'Each bar as a body (open to close) with wicks to the high and low.',
    long: 'The default, and the most information per bar. Green means the close was above the open. '
      + 'Below roughly a pixel per bar the body carries nothing, so switch to a line for long views.',
    seeAlso: ['lineChart', 'ohlcBars'],
  },
  ohlcBars: {
    term: 'Bars (OHLC)', group: 'chart',
    short: 'A vertical line per bar with ticks left for open and right for close.',
    long: 'Denser than candlesticks and easier to read when bars are narrow, because there is no body '
      + 'to fill.',
    seeAlso: ['candles'],
  },
  lineChart: {
    term: 'Line', group: 'chart',
    short: 'Closing prices joined up. The right choice for multi-year views.',
    long: 'Throws away open, high and low and gains legibility. At 2,500 bars a candle is under a '
      + 'pixel wide, so a line shows the shape a candle chart only smears.',
    seeAlso: ['candles', 'areaChart'],
  },
  areaChart: {
    term: 'Area', group: 'chart',
    short: 'A line with the space beneath it filled.',
    long: 'Same information as a line; the fill makes the overall direction easier to read at a glance.',
    seeAlso: ['lineChart'],
  },
  baselineChart: {
    term: 'Baseline', group: 'chart',
    short: 'Coloured above and below a reference price — your average cost when you hold it.',
    long: 'Answers "am I up or down on this position" with no arithmetic. When you have no position in '
      + 'the instrument the reference is the first visible bar, so it shows the move since the window '
      + 'opened.',
    seeAlso: ['avgCost'],
  },
  linScale: {
    term: 'Linear scale', group: 'chart',
    short: 'Equal price moves get equal height.',
    long: 'The default and the right choice for short windows. Over many years it exaggerates recent '
      + 'moves, because a 100-point move is the same height whether the price was 1,000 or 25,000.',
    seeAlso: ['logScale'],
  },
  logScale: {
    term: 'Log scale', group: 'chart',
    short: 'Equal PERCENTAGE moves get equal height. The honest scale for long views.',
    long: 'On a decade of an index, a linear axis makes the last two years look like all the movement. '
      + 'A log axis shows a 10% move as the same height wherever it happened, which is what a '
      + 'percentage-minded trader actually compares.',
    seeAlso: ['linScale', 'pctScale'],
  },
  pctScale: {
    term: 'Percent scale', group: 'chart',
    short: 'Everything measured from the first visible bar, in percent.',
    long: 'Use it to read the SIZE of a move rather than its price — "this rallied 18% off the low" '
      + 'without doing the division.',
    seeAlso: ['logScale'],
  },
  volumePane: {
    term: 'Volume', group: 'chart',
    short: 'How much traded in each bar, in its own pane below price.',
    long: 'Coloured to match the bar. A move on unusually high volume is generally taken more '
      + 'seriously than the same move on thin volume. Many indices report no volume at all, in which '
      + 'case the pane is empty and that is not a fault.',
    seeAlso: ['volumeSurge'],
  },
  oscillatorPane: {
    term: 'Oscillator pane', group: 'chart',
    short: 'A separate pane for indicators on their own scale, like RSI and MACD.',
    long: 'A 0-to-100 indicator cannot share an axis with a 24,000-point index — it would draw as a '
      + 'flat line along the bottom. Each oscillator therefore gets its own pane, which you can resize '
      + 'by dragging the separator.',
    seeAlso: ['rsi', 'macd'],
  },
  crosshairLegend: {
    term: 'Legend', group: 'chart',
    short: 'The values of the bar under your cursor, shown top-left over the chart.',
    long: 'O, H, L, C and volume for the hovered bar, plus any indicator values at that point. It sits '
      + 'on the chart rather than below it so reading a bar does not mean looking away from it. The '
      + 'same values are repeated in text below for screen readers.',
    seeAlso: ['candles'],
  },
  fitZoom: {
    term: 'Reset zoom', group: 'chart',
    short: 'Fit every bar in the window back into view.',
    long: 'The chart deliberately does NOT re-fit when new bars arrive, so a background refresh cannot '
      + 'throw away the zoom you set. This button is how you get back.',
  },
  projection: {
    term: 'Projection cone', group: 'chart',
    short: 'The range this instrument\'s own volatility calls ordinary over the horizon.',
    long: 'Not a forecast of direction. It draws where price would sit if it moved by a typical amount '
      + 'for this instrument. When no model has cleared the acceptance gate the centre line is flat '
      + 'and drawn grey — meaning "last price extended", not "we expect no change".',
    seeAlso: ['coneTilted', 'acceptanceGate'],
  },
  coneTilted: {
    term: 'Tilted cone', group: 'chart',
    short: 'A cone whose centre a validated model was allowed to move off flat.',
    long: 'A tilted centre gets the accent colour because a model that cleared the gate moved it. A '
      + 'flat centre stays grey and dotted. The visual weight tracks the evidence on purpose.',
    seeAlso: ['projection', 'acceptanceGate'],
  },
  yourFills: {
    term: 'Your fills', group: 'chart',
    short: 'Arrows on the bars where you actually bought or sold.',
    long: 'Drawn from your own recorded trades in YOUR BOOK. This is what turns a chart into "where am '
      + 'I inside this move" rather than an abstract picture.',
    seeAlso: ['fill', 'position'],
  },
  levels: {
    term: 'Levels', group: 'chart',
    short: 'Horizontal price lines: a signal\'s entry, stop and targets, and your own stop and target.',
    long: 'A signal\'s levels are drawn thin. Levels YOU declared are drawn thicker, because what you '
      + 'committed to is stronger evidence about your intent than any suggestion.',
    seeAlso: ['stopLoss', 'thesis'],
  },

  // ── Indicators ────────────────────────────────────────────────────────────
  overlay: {
    term: 'Indicator', group: 'overlays',
    short: 'Arithmetic on the bars already on screen. Never a forecast.',
    long: 'Every indicator here is a pure function of the visible bars — it asserts nothing the bars do '
      + 'not already contain. Anything forward-looking comes from the engine and is drawn separately, '
      + 'which is why the projection cone is not in this menu.',
    seeAlso: ['sma', 'ema', 'bollinger', 'rsi', 'macd', 'vwap', 'oscillatorPane', 'projection'],
  },
  sma: {
    term: 'SMA', group: 'overlays',
    short: 'Simple moving average — the mean close over N bars.',
    long: 'The plainest trend measure there is. Price above a long SMA is usually read as an uptrend. '
      + 'It has no value until N bars exist, so the line starts late rather than drawing a partial '
      + 'average that would be a wrong number looking right.',
    seeAlso: ['ema', 'priceVsSma'],
  },
  ema: {
    term: 'EMA', group: 'overlays',
    short: 'Exponential moving average — weighted toward recent bars, so it turns sooner.',
    long: 'Reacts faster than an SMA of the same length to a change of level, at the cost of more false '
      + 'turns in a choppy market.',
    seeAlso: ['sma'],
  },
  bollinger: {
    term: 'Bollinger Bands', group: 'overlays',
    short: 'A moving average with a volatility band either side.',
    long: 'The bands widen when the instrument is moving more. Price at a band is not a signal by '
      + 'itself — in a strong trend price can sit on the upper band for weeks.',
    seeAlso: ['sma', 'atrExpansion'],
  },
  rsi: {
    term: 'RSI', group: 'overlays',
    short: 'Relative Strength Index, 0 to 100. Above 70 is called overbought, below 30 oversold.',
    long: '"Overbought" does not mean "about to fall" — a strong trend can hold RSI above 70 for a long '
      + 'time. It is best used as a condition that some other rule acts inside. Wilder\'s smoothing is '
      + 'used, which is the standard definition.',
    seeAlso: ['oscillatorPane', 'rsiBand'],
  },
  macd: {
    term: 'MACD', group: 'overlays',
    short: 'The gap between a fast and a slow EMA, plus a signal line and a histogram.',
    long: 'A momentum measure. The usual reading is the MACD line crossing its signal line; the '
      + 'histogram is the distance between the two, so it crosses zero at the same moment.',
    seeAlso: ['ema', 'macdCross'],
  },
  vwap: {
    term: 'VWAP', group: 'overlays', seeAlso: ['volumePane'],
    short: 'The volume-weighted average price so far TODAY. Intraday only.',
    long: 'Anchoring is the whole point — it means "the average price paid today", so it resets each '
      + 'session. Run across days it drifts and stops meaning what the name says, which is why it is '
      + 'not offered on daily bars rather than being drawn wrong.',
    seeAlso: ['volumePane'],
  },

  // ── Signals ───────────────────────────────────────────────────────────────
  setup: {
    term: 'Setup', group: 'signals',
    short: 'Which risk geometry this row represents.',
    long: 'The rows for one symbol are different ways of placing stop and targets around the same '
      + 'prediction — tighter stop and nearer target, or wider and further. Not independent forecasts.',
    seeAlso: ['signal', 'riskReward'],
  },
  directionType: {
    term: 'Direction (LONG / SHORT)', group: 'signals',
    short: 'Whether the setup is to buy first or to sell first.',
    long: 'LONG profits if price rises; SHORT profits if it falls. On a short, the stop sits ABOVE '
      + 'entry and the targets below.',
    seeAlso: ['directionFilter'],
  },
  entryPrice: {
    term: 'Entry', group: 'signals',
    short: 'The price the setup assumes you get in at.',
    long: 'Derived from the last stored close, not typed, so a setup cannot be priced off a stale '
      + 'number. If the market has moved since the history was loaded, reload before acting.',
    seeAlso: ['basePrice'],
  },
  stopLoss: {
    term: 'Stop loss (SL)', group: 'signals',
    short: 'The price at which the setup is wrong and the position should be closed.',
    long: 'The single most important number in a setup, because it is what turns a trade into a bounded '
      + 'risk and is what position size is calculated from. A setup without a stop cannot be sized.',
    seeAlso: ['riskAmount', 'positionSize'],
  },
  targets: {
    term: 'Targets (T1, T2, T3)', group: 'signals',
    short: 'Three progressively further prices where the setup suggests taking profit.',
    long: 'T1 is the nearest and most likely; T3 the furthest and least. Each carries its own '
      + 'probability in the WHY panel. A common approach is to close part of the position at T1 and '
      + 'let the rest run.',
    seeAlso: ['riskReward', 'probability'],
  },
  riskReward: {
    term: 'R:R', group: 'signals',
    short: 'Reward divided by risk — the distance to the target over the distance to the stop.',
    long: 'An R:R of 2 means the target is twice as far as the stop, so you can be right less than half '
      + 'the time and still come out ahead. Below 1, you need to be right more often than you are wrong '
      + 'just to break even — before costs.',
    seeAlso: ['stopLoss', 'targets', 'expectancy'],
  },
  probability: {
    term: 'Probability', group: 'signals',
    short: 'The modelled chance of reaching T1 before the stop.',
    long: 'A model output, not a promise, and worth little while no model has cleared the acceptance '
      + 'gate — see the ENGINE tab for whether one has. Treat it as the engine\'s opinion rather than '
      + 'a measured frequency.',
    seeAlso: ['acceptanceGate', 'probabilityBasis'],
  },
  grade: {
    term: 'Grade', group: 'signals',
    short: 'The engine\'s own confidence band for the setup, A+ down to D.',
    long: 'A composite of probability, risk-to-reward and how much the models agreed. It is a summary '
      + 'of the other columns rather than extra information, and it inherits their limits.',
    seeAlso: ['probability', 'modelAgreement'],
  },
  suppressed: {
    term: 'Suppressed', group: 'signals',
    short: 'A setup Rāma computed and is deliberately not recommending.',
    long: 'Usually because the models disagreed too much. Shown rather than hidden so you can see that '
      + 'it was considered, which is more honest than a shorter list with no explanation.',
    seeAlso: ['modelAgreement'],
  },
  directionalProbability: {
    term: 'Directional probability', group: 'signals',
    short: 'The ensemble\'s view on direction alone, before any stop or target is placed.',
    long: 'Separating this from the T1 probability matters: direction can look favourable while the '
      + 'specific geometry is poor, because the stop is too close to survive ordinary noise.',
    seeAlso: ['probability', 'riskReward'],
  },
  slProbability: {
    term: 'SL risk', group: 'signals',
    short: 'The modelled chance of hitting the stop before any target.',
    long: 'Read it next to the T1 probability. A setup with a 60% chance at T1 and a 55% chance of '
      + 'being stopped first is not the favourable trade the first number alone suggests.',
    seeAlso: ['stopLoss', 'probability'],
  },
  regime: {
    term: 'Regime', group: 'signals',
    short: 'What kind of market the engine thinks this currently is — trending, ranging, volatile.',
    long: 'Rules behave differently by regime: a breakout rule works in a trend and bleeds in a range. '
      + 'The engine reports the regime it classified so you can judge whether the setup suits it.',
    seeAlso: ['atrExpansion'],
  },
  modelAgreement: {
    term: 'Agreement', group: 'signals',
    short: 'The share of models that landed within 0.15 of the blended probability. 0 to 1.',
    long: 'High agreement means the ensemble is saying one thing. Low agreement means the blended '
      + 'number is an average over models that disagree, which makes it less trustworthy than its '
      + 'single value suggests — and is what causes a setup to be suppressed.',
    seeAlso: ['suppressed', 'uncertainty'],
  },
  uncertainty: {
    term: 'Uncertainty', group: 'signals',
    short: 'How much the models\' outputs were spread out. Lower is more confident.',
    long: 'A companion to agreement rather than a duplicate: agreement counts how many models were '
      + 'close, uncertainty measures how far apart they all were. A high value means treat every other '
      + 'number on the row with more caution.',
    seeAlso: ['modelAgreement'],
  },
  maxRisk: {
    term: 'Max risk', group: 'signals',
    short: 'The largest loss this setup would take if the stop is honoured, in currency.',
    long: 'Computed from your capital and risk percentage. If it looks wrong, the capital or risk field '
      + 'above is wrong — this figure is derived, not entered.',
    seeAlso: ['riskAmount', 'positionSize'],
  },
  validityBars: {
    term: 'Valid for', group: 'signals',
    short: 'How many bars the setup is considered live for.',
    long: 'After this many bars the conditions it was computed under have probably changed, and it '
      + 'should be requested again rather than acted on. On daily bars, "5 bars" is about a week.',
    seeAlso: ['interval', 'horizon'],
  },
  probabilityBasis: {
    term: 'Probability basis', group: 'signals',
    short: 'Where the probability came from — which models, fitted on what.',
    long: 'Provenance, so a number can always be traced. If it says the probability is untrained or '
      + 'uncalibrated, that is the honest state and the number should not be leaned on.',
    seeAlso: ['probability', 'featureContract'],
  },
  reasons: {
    term: 'Why', group: 'signals',
    short: 'The features that drove this reading, in the engine\'s own words.',
    long: 'Straight from the ensemble, not written afterwards to fit the answer. If the reasons do not '
      + 'match what you see on the chart, trust the chart and treat the setup with suspicion.',
  },

  // ── Capital and risk ──────────────────────────────────────────────────────
  directionFilter: {
    term: 'Direction filter', group: 'sizing',
    short: 'Whether to return long setups, short setups, or both.',
    long: 'A filter on what comes back, not an instruction to the model. Set it to Long if you only '
      + 'take long trades, so the list is not half things you will not act on.',
    seeAlso: ['directionType'],
  },
  basePrice: {
    term: 'Base price', group: 'sizing',
    short: 'The last stored close. Read-only on purpose.',
    long: 'It was a typed field once, which invited pricing a setup off a number the market had left '
      + 'days earlier. It now comes from the last bar you loaded, so it is only as fresh as the '
      + 'history — reload before requesting if the market has moved.',
    seeAlso: ['entryPrice', 'fromDisk'],
  },
  capital: {
    term: 'Capital', group: 'sizing',
    short: 'The amount you are sizing positions against.',
    long: 'Not necessarily your whole account — it is the pool this instrument is allowed to draw on. '
      + 'Every currency figure on the screen is derived from it.',
    seeAlso: ['riskPct', 'riskAmount'],
  },
  riskPct: {
    term: 'Risk per trade', group: 'sizing',
    short: 'The share of capital you accept losing if the stop is hit.',
    long: 'Most disciplined traders sit between 0.5% and 2%. The reason it is a percentage of capital '
      + 'and not a number of units is that it keeps the loss the same across instruments of wildly '
      + 'different prices. Above about 5%, a run of five losses is a serious dent.',
    seeAlso: ['riskAmount', 'positionSize'],
  },
  riskAmount: {
    term: 'Amount at risk', group: 'sizing',
    short: 'Capital times risk percent — the money on the line per trade.',
    long: 'Shown because the percentage alone hides the number you are actually choosing. This is the '
      + 'figure to sanity-check before acting: if losing it would change your decisions, the '
      + 'percentage is too high.',
    seeAlso: ['riskPct', 'positionSize'],
  },
  positionSize: {
    term: 'Position size', group: 'sizing',
    short: 'Amount at risk divided by the distance to the stop.',
    long: 'This is why a stop is mandatory for sizing: the distance to it is the per-unit risk. A wider '
      + 'stop means fewer units, so the money at risk stays the same. Without a stop there is nothing '
      + 'to divide by and Rāma reports no size rather than inventing one.',
    seeAlso: ['stopLoss', 'riskAmount', 'netQty', 'invested'],
  },

  // ── Your book ─────────────────────────────────────────────────────────────
  position: {
    term: 'Position', group: 'book',
    short: 'Something you hold, built from the fills you recorded.',
    long: 'Rāma does not connect to your broker. You record what you traded, and in exchange it can '
      + 'watch your stops, your holding periods and your concentration, and mark your fills on the '
      + 'chart.',
    seeAlso: ['fill', 'yourFills'],
  },
  fill: {
    term: 'Fill', group: 'book',
    short: 'One buy or sell that happened — quantity, price, date, fees.',
    long: 'Positions are derived from fills rather than stored as a summary, so realised profit stays '
      + 'traceable to the trades that produced it, and a mistyped fill can be removed.',
    seeAlso: ['position', 'partialExit'],
  },
  netQty: {
    term: 'Quantity', group: 'book',
    short: 'Units currently open. Negative means short.',
    long: 'The net of every fill. A negative quantity flips the direction of profit: a short gains when '
      + 'price falls.',
    seeAlso: ['directionType'],
  },
  avgCost: {
    term: 'Average cost', group: 'book',
    short: 'What you paid on average per unit, across every fill.',
    long: 'Includes any fees you recorded. It is the reference the baseline chart uses and the number '
      + 'unrealised profit is measured from.',
    seeAlso: ['baselineChart', 'unrealisedPnl'],
  },
  lastPrice: {
    term: 'Last price', group: 'book',
    short: 'The newest stored close for the symbol. Amber when it is behind.',
    long: 'Your book is marked against stored history, not a live feed. If the price is stale, every '
      + 'profit figure derived from it is stale too — which is why it is flagged rather than shown '
      + 'plainly.',
    seeAlso: ['priceStale', 'fetchProvider'],
  },
  priceStale: {
    term: 'Stale price', group: 'book',
    short: 'The stored price is older than it should be, so profit figures are behind.',
    long: 'Fetch history for that symbol to refresh it. A total computed from stale prices is reported '
      + 'as such rather than presented as current.',
    seeAlso: ['lastPrice', 'unpricedSymbols'],
  },
  unrealisedPnl: {
    term: 'Unrealised P&L', group: 'book',
    short: 'Profit or loss on positions still open, at the last stored price.',
    long: 'It moves with the market and is not money you have. It becomes realised only when you '
      + 'record the exit.',
    seeAlso: ['realisedPnl', 'lastPrice'],
  },
  realisedPnl: {
    term: 'Realised P&L', group: 'book',
    short: 'Profit or loss actually locked in by closed positions.',
    long: 'Derived from the recorded fills rather than stored as a summary, so every figure stays '
      + 'traceable to the trades that produced it and a mistyped entry can be corrected. This is the '
      + 'number that actually measures how you have done.',
    seeAlso: ['unrealisedPnl', 'netOfFees', 'fill'],
  },
  netOfFees: {
    term: 'Net of fees', group: 'book',
    short: 'Everything, after the charges you recorded.',
    long: 'The only figure worth judging performance on. A strategy that looks profitable gross and '
      + 'loses net is the commonest trap in trading, and it hurts most at short holding periods.',
    seeAlso: ['costDrag'],
  },
  invested: {
    term: 'Invested', group: 'book',
    short: 'What your open positions cost you.',
    long: 'Compare it against market value to see the direction of travel; compare it against capital '
      + 'to see how much of your pool is committed.',
    seeAlso: ['marketValue'],
  },
  marketValue: {
    term: 'Market value', group: 'book',
    short: 'What your open positions are worth at the last stored prices.',
    long: 'If some symbols have no stored price they cannot be valued, and Rāma names them rather than '
      + 'quietly leaving them out of the total.',
    seeAlso: ['unpricedSymbols'],
  },
  unpricedSymbols: {
    term: 'Unpriced symbols', group: 'book',
    short: 'Positions with no stored price, so they are excluded from the totals.',
    long: 'Reported by name rather than folded in as zero, because a total that silently omits a '
      + 'holding is worse than one that says what it is missing. Fetch history for them before '
      + 'trusting the totals.',
    seeAlso: ['marketValue', 'fetchProvider'],
  },
  daysHeld: {
    term: 'Days held', group: 'book',
    short: 'Calendar days since your first fill in this position.',
    long: 'Read it against the trade style. An INTRADAY position showing 14 days is the expensive '
      + 'mistake this column exists to surface.',
    seeAlso: ['tradeStyle', 'styleVsThesis'],
  },
  tradeStyle: {
    term: 'Trade style', group: 'book',
    short: 'How you intended to hold it: intraday, swing, positional or long term.',
    long: 'It is not cosmetic — it decides which warnings Rāma raises. An intraday position still open '
      + 'overnight is treated as urgent; a long-term one is not.',
    seeAlso: ['daysHeld', 'styleAssumed'],
  },
  styleAssumed: {
    term: 'Style (assumed)', group: 'book',
    short: 'Rāma guessed the style because the position predates the field.',
    long: 'Shown as POSITIONAL until you set the real one. Until then the warnings are calibrated for '
      + 'the wrong holding period, so it is worth correcting.',
    seeAlso: ['tradeStyle'],
  },
  styleVsThesis: {
    term: 'Style vs thesis', group: 'book',
    short: 'A note when how you are holding it contradicts what you said you would do.',
    long: 'For example a stated intraday thesis on a position held for two weeks. It is not an error, '
      + 'it is a discrepancy between your plan and your behaviour, which is exactly the thing a ledger '
      + 'is for.',
    seeAlso: ['thesis', 'tradeStyle'],
  },
  thesis: {
    term: 'Thesis', group: 'book',
    short: 'What you expected when you took the trade — stop, target, horizon and reason.',
    long: 'The most valuable thing in the book, and it can only come from you. Without it, "was I right '
      + 'or lucky?" has no answer later, and Rāma cannot warn you about a stop it was never told.',
    seeAlso: ['thesisStop', 'rationale'],
  },
  thesisStop: {
    term: 'Your stop', group: 'book',
    short: 'The exit price you committed to when you opened the position.',
    long: 'Drawn thicker on the chart than any signal\'s stop, because what you declared is stronger '
      + 'evidence about your intent than a suggestion. Rāma warns you when price approaches it.',
    seeAlso: ['thesis', 'levels'],
  },
  rationale: {
    term: 'Why you took it', group: 'book',
    short: 'Your own reason, in your own words.',
    long: 'Unstructured on purpose. Reading old rationales back is the cheapest way to notice a pattern '
      + 'in your own mistakes.',
    seeAlso: ['thesis'],
  },
  partialExit: {
    term: 'Partial exit', group: 'book',
    short: 'Closing some of a position and leaving the rest open.',
    long: 'Recorded as a reducing fill rather than a close, so the remaining position keeps its '
      + 'original thesis and its holding period. The exit form tells you which of the two it is about '
      + 'to record.',
    seeAlso: ['fill', 'position'],
  },
  actionableAlert: {
    term: 'Needs your attention', group: 'book',
    short: 'A warning Rāma is prepared to stand behind and act on.',
    long: 'These come from facts, not predictions: a stop breached, a holding period exceeded, a '
      + 'concentration building. They do not depend on any model clearing a gate, which is why they '
      + 'are shown while model readings are withheld.',
    seeAlso: ['withheldAlert'],
  },
  withheldAlert: {
    term: 'Readings not acted on', group: 'book',
    short: 'Things Rāma noticed but will not recommend acting on, with the reason.',
    long: 'Usually an unvalidated model reading. Collapsed behind a count so that a real stop breach is '
      + 'never sitting next to a speculative note as though they were the same kind of statement.',
    seeAlso: ['actionableAlert', 'acceptanceGate'],
  },

  // ── Strategy builder ──────────────────────────────────────────────────────
  block: {
    term: 'Block', group: 'strategy',
    short: 'One condition you can put into a strategy.',
    long: 'Blocks are grouped by what they are evidence OF — trend structure, momentum, volatility, '
      + 'session — rather than by how they are computed. Pick one for a simple rule, or several and '
      + 'combine them.',
    seeAlso: ['combiner', 'strategy', 'sessionBlock', 'sweep'],
  },
  combiner: {
    term: 'Combiner', group: 'strategy',
    short: 'How your blocks combine: all, any, or at least k of them.',
    long: '"All" trades rarely and more selectively; "any" trades often and less so. "At least k" sits '
      + 'between them and is useful when you have five weak confirmations and want three.',
    seeAlso: ['block'],
  },
  higherStructure: {
    term: 'Higher highs and higher lows', group: 'strategy',
    short: 'An uptrend defined by structure rather than by an indicator.',
    long: 'Both conditions, not either: higher highs alone also happens in a widening range that is '
      + 'going nowhere. A swing is only counted once the bars after it confirm it, which is later than '
      + 'it looks on a finished chart.',
    seeAlso: ['lowerStructure', 'trendlineBreak'],
  },
  lowerStructure: {
    term: 'Lower lows and lower highs', group: 'strategy',
    short: 'A downtrend by structure — the mirror of the above.',
    long: 'Usually paired with a short side. The same confirmation delay applies.',
    seeAlso: ['higherStructure'],
  },
  trendlineBreak: {
    term: 'Trendline break', group: 'strategy',
    short: 'Close crossing a line fitted over the previous N bars.',
    long: 'A least-squares line, not two hand-picked touches, so the test is reproducible — a backtest '
      + 'of a line you would have drawn differently is not a backtest of anything.',
    seeAlso: ['higherStructure'],
  },
  breakoutBlock: {
    term: 'N-bar break', group: 'strategy',
    short: 'Close beyond the highest high or lowest low of the previous N bars.',
    long: 'The classic breakout. The window ends at the bar BEFORE the one being judged, so the bar is '
      + 'not part of its own test — including it makes the rule nearly always true.',
    seeAlso: ['volumeSurge'],
  },
  volumeSurge: {
    term: 'Volume surge', group: 'strategy',
    short: 'Volume a multiple of its own recent average.',
    long: 'Often used to confirm a breakout. Many indices report no volume, in which case this never '
      + 'fires — the trade count will show it as zero rather than failing.',
    seeAlso: ['volumePane', 'breakoutBlock'],
  },
  atrExpansion: {
    term: 'ATR expansion', group: 'strategy',
    short: 'True range running above its own longer average — a volatility filter.',
    long: 'Not a direction signal. Used to require that something is actually moving before a rule is '
      + 'allowed to act.',
    seeAlso: ['bollinger', 'regime'],
  },
  priceVsSma: {
    term: 'Price vs SMA', group: 'strategy',
    short: 'A regime filter: only act while price is above, or below, a long average.',
    long: 'Almost never a trigger on its own — it is true for months at a time. Combine it with '
      + 'something that fires.',
    seeAlso: ['sma', 'combiner'],
  },
  rsiBand: {
    term: 'RSI band', group: 'strategy',
    short: 'RSI beyond a level, as a condition.',
    long: 'Oversold is a condition, not an entry. Pairing it with a trend block is the difference '
      + 'between buying a dip and buying a collapse.',
    seeAlso: ['rsi'],
  },
  macdCross: {
    term: 'MACD signal cross', group: 'strategy',
    short: 'The MACD line crossing its own signal line.',
    long: 'A cross rather than a level, because a level test is true for every bar of a trend and '
      + 'multiplies your trade count and therefore your costs.',
    seeAlso: ['macd'],
  },
  sessionBlock: {
    term: 'Session filters', group: 'strategy',
    short: 'Day of week, or a time-of-day window on intraday bars.',
    long: 'The cheapest way to test whether a day-of-week or time-of-day effect is real, and usually it '
      + 'is not. Times are in UTC because the store keeps intraday stamps that way: the 09:15 IST open '
      + 'is minute 225.',
    seeAlso: ['interval'],
  },
  stopPctBlock: {
    term: 'Stop %', group: 'strategy',
    short: 'How far below entry (above, for a short) the strategy gives up.',
    long: 'A strategy needs at least one exit rule. Without a stop, a target or a bar limit, every '
      + 'trade runs to the end of the data and the result describes the instrument rather than the '
      + 'strategy.',
    seeAlso: ['targetPctBlock', 'maxBarsBlock'],
  },
  targetPctBlock: {
    term: 'Target %', group: 'strategy',
    short: 'How far in your favour the strategy takes profit.',
    long: 'A target no further than the stop needs a win rate above 50% just to break even before '
      + 'costs. Rāma warns when that is the case.',
    seeAlso: ['riskReward', 'stopPctBlock'],
  },
  maxBarsBlock: {
    term: 'Max bars', group: 'strategy',
    short: 'Give up after this many bars whatever the price. 0 means no time limit.',
    long: 'A time exit keeps holding periods honest, which keeps cost drag honest — a rule that '
      + 'occasionally holds for a year has a very different cost profile from its average suggests.',
    seeAlso: ['costDrag'],
  },
  sweep: {
    term: 'Sweep', group: 'strategy',
    short: 'Several values for one parameter, so Rāma tries each.',
    long: 'Type comma-separated values. Every sweep multiplies the variant count, and the variant count '
      + 'raises the bar a result has to clear — so widening a search makes a result harder to believe, '
      + 'not easier. That is why it is something you type rather than a range control.',
    seeAlso: ['trials', 'noiseBenchmark'],
  },
  trials: {
    term: 'Variants', group: 'strategy',
    short: 'How many configurations the search will try. The most important number on the screen.',
    long: 'Search enough variants and one will look excellent whether or not any edge exists, because '
      + 'the best of many noisy results is biased upward. Rāma raises the required result in '
      + 'proportion to this count, and shows it BEFORE you run so it can be a decision.',
    seeAlso: ['noiseBenchmark', 'deflated'],
  },
  notBacktestable: {
    term: 'Not backtestable', group: 'strategy',
    short: 'A block that can run live but cannot honestly be tested on history.',
    long: 'Two of them. Model probability would be look-ahead, because the model was fitted on the '
      + 'period a backtest would test it over. News and sentiment have no free feed with enough '
      + 'history to measure. Both are offered for a live strategy; a backtest containing either is '
      + 'refused, with the reason.',
    seeAlso: ['lookAhead'],
  },
  lookAhead: {
    term: 'Look-ahead', group: 'strategy',
    short: 'Using information a rule could not have had at the time.',
    long: 'The most flattering bug in backtesting and the hardest to spot, because the result looks '
      + 'excellent rather than broken. Three defences are built in: entry on the next bar\'s open, '
      + 'swing points confirmed late, and breakout windows that end before the bar being judged.',
    seeAlso: ['notBacktestable', 'holdout'],
  },
  generatedPython: {
    term: 'Generated Python', group: 'strategy',
    short: 'A standalone script implementing your strategy. It prints signals; it places no orders.',
    long: 'The block logic in it is copied from the engine functions that ran the backtest, so the file '
      + 'and the verdict cannot disagree. The header carries the verdict — including "NOT BACKTESTED" '
      + 'when there is none — so the file can never look like an endorsement it did not earn.',
    seeAlso: ['noOrders'],
  },
  noOrders: {
    term: 'No order placement', group: 'strategy',
    short: 'Rāma never places, modifies or cancels a trade. By design, permanently.',
    long: 'It reads, analyses and reports. It will not be given the ability to act in a market on your '
      + 'behalf, and the generated code does not either. Every decision stays yours.',
  },

  // ── How a strategy is judged ──────────────────────────────────────────────
  holdout: {
    term: 'Holdout', group: 'judgement',
    short: 'A final slice of history the search is never allowed to see.',
    long: 'The search ranks variants on the earlier part of the data; exactly one winner is then tested '
      + 'once against the holdout. A holdout consulted while choosing has already become training '
      + 'data, which is the commonest way this kind of test gets ruined.',
    seeAlso: ['backtest', 'trials'],
  },
  netSharpe: {
    term: 'Net Sharpe', group: 'judgement',
    short: 'Return per unit of risk, after costs. Higher is better.',
    long: 'Net, always — a strategy profitable only before costs is not a strategy. It is the headline '
      + 'risk-adjusted measure, and on its own it is not enough, because it says nothing about how many '
      + 'variants were tried to find it.',
    seeAlso: ['grossSharpe', 'noiseBenchmark'],
  },
  grossSharpe: {
    term: 'Gross Sharpe', group: 'judgement',
    short: 'The same measure before trading costs.',
    long: 'Shown only for comparison. The gap between gross and net IS the cost drag, and it widens as '
      + 'holding periods shorten.',
    seeAlso: ['netSharpe', 'costDrag'],
  },
  noiseBenchmark: {
    term: 'Noise benchmark', group: 'judgement',
    short: 'The Sharpe a search of this many variants would produce from pure luck.',
    long: 'With 1,000 zero-edge variants, the best observed Sharpe is not 0 — it is roughly this. Your '
      + 'result has to beat this number, not zero, to mean anything. It rises as you search wider, '
      + 'which is the mathematical reason a wider search is weaker evidence.',
    seeAlso: ['trials', 'deflated'],
  },
  deflated: {
    term: 'Chance it is real', group: 'judgement',
    short: 'The probability the result is a genuine edge rather than the best of many tries.',
    long: 'A deflated Sharpe ratio: the observed result, adjusted for how many variants were searched '
      + 'and for the fact that trading returns are skewed and fat-tailed. Rāma requires 95% before it '
      + 'will call an edge demonstrated.',
    seeAlso: ['noiseBenchmark', 'edge'],
  },
  winRate: {
    term: 'Win rate', group: 'judgement',
    short: 'The share of trades that made money, after costs.',
    long: 'The most over-read number in trading. A 40% win rate with a 3:1 reward beats a 70% win rate '
      + 'with a 1:3 reward. And a backtested win rate is NOT a forward-looking probability.',
    seeAlso: ['expectancy', 'riskReward'],
  },
  expectancy: {
    term: 'Expectancy', group: 'judgement',
    short: 'The average net result per trade, in percent.',
    long: 'More useful than win rate because it combines how often you win with how much. If it is '
      + 'negative the strategy loses money however good the win rate looks.',
    seeAlso: ['winRate'],
  },
  maxDrawdown: {
    term: 'Max drawdown', group: 'judgement',
    short: 'The worst peak-to-trough fall along the way.',
    long: 'The number that decides whether you could actually have followed the strategy. A rule '
      + 'returning 30% a year through a 45% drawdown is one almost nobody sticks with, and abandoning '
      + 'it at the bottom is worse than never starting.',
    seeAlso: ['roi'],
  },
  costDrag: {
    term: 'Cost drag', group: 'judgement',
    short: 'The assumed round-trip cost of one trade — commission, slippage and spread.',
    long: 'Applied to every trade, and never zero by default, because a forgotten cost model produces a '
      + 'flattering answer instead of an obviously wrong one. Check it against your own broker before '
      + 'believing a marginal result.',
    seeAlso: ['netOfFees', 'netSharpe'],
  },
  confidence: {
    term: 'Confidence', group: 'judgement',
    short: 'none, provisional or measured — how much evidence stands behind the verdict.',
    long: 'Under 30 trades Rāma gives no verdict at all rather than a percentage. Between 30 and 100 it '
      + 'is provisional and should be treated as a lead. Above 100 it is measured.',
    seeAlso: ['trials', 'holdout'],
  },
  roi: {
    term: 'ROI', group: 'judgement',
    short: 'Return on capital over the holdout. Reported, never requested.',
    long: 'There is deliberately no target-return field anywhere: a search that keeps going until '
      + 'something meets a target will always find something, in noise as readily as in an edge. Read '
      + 'ROI next to the drawdown and the variant count, never alone.',
    seeAlso: ['maxDrawdown', 'trials'],
  },

  // ── Engine ────────────────────────────────────────────────────────────────
  engineStatus: {
    term: 'Status', group: 'engine',
    short: 'What the last request did: idle, requesting, done, or error.',
    long: 'It refers to the most recent signal request on this screen, not to the health of the engine. '
      + 'The ENGINE tab is where engine health lives.',
    seeAlso: ['modelsTrained'],
  },
  absorbedEngine: {
    term: 'Absorbed engine', group: 'engine',
    short: 'StockMind\'s prediction maths was taken into Rāma rather than called as a separate app.',
    long: 'Provenance rather than a feature: the Python prediction engine runs as a child process of '
      + 'Rāma, so there is no separate service to start and no second identity system. If you see '
      + '"engine not running", that process has not started.',
    seeAlso: ['engineStatus'],
  },
  modelsTrained: {
    term: 'Models trained', group: 'engine',
    short: 'How many models have been fitted and stored.',
    long: 'Zero is a normal state on a fresh install and means every probability on the screen is '
      + 'untrained. Training needs a deep history to be fetched first.',
    seeAlso: ['acceptanceGate', 'probability'],
  },
  featureContract: {
    term: 'Feature contract', group: 'engine',
    short: 'Whether the inputs a model was trained on still match what the engine computes today.',
    long: 'MISALIGNED means the feature set changed after training, so the stored models are being fed '
      + 'something different from what they learned on and their outputs cannot be trusted. Retraining '
      + 'is the fix.',
    seeAlso: ['modelsTrained'],
  },
  acceptanceGate: {
    term: 'Acceptance gate', group: 'engine',
    short: 'The bar a model must clear on live data before Rāma will act on its output.',
    long: 'When no model clears it, directional readings are still SHOWN — because hiding them would '
      + 'hide that they exist — but they are not acted on, and alerts derived from them are withheld. '
      + 'Warnings that do not depend on a model, such as a breached stop, are unaffected.',
    seeAlso: ['withheldAlert', 'probability'],
  },
  horizon: {
    term: 'Horizon', group: 'engine',
    short: 'How far ahead a question looks: intraday, swing or positional.',
    long: 'A horizon is a bar interval AND a number of those bars — "3 hours" cannot be expressed in '
      + 'daily bars at all. The three are trained and reported separately and never averaged, because '
      + 'a 3-hour call and a 1-month call are different questions and their disagreement is '
      + 'information.',
    seeAlso: ['interval', 'validityBars'],
  },

  // ── Derivatives ───────────────────────────────────────────────────────────
  pcrOi: {
    term: 'PCR (OI)', group: 'derivs',
    short: 'Put open interest divided by call open interest for the nearest expiry.',
    long: 'Traditionally read as sentiment — above about 1.3 is called bullish, below 0.7 bearish, on '
      + 'the theory that put writers expect support. Treat it as context, not a signal.',
    seeAlso: ['maxPain'],
  },
  maxPain: {
    term: 'Max pain', group: 'derivs',
    short: 'The strike at which option writers would pay out least.',
    long: 'Often watched as a price magnet near expiry. It is a description of where the open interest '
      + 'sits, not a prediction, and it moves as positions change.',
    seeAlso: ['pcrOi', 'daysToExpiry'],
  },
  oiSupportResistance: {
    term: 'OI support and resistance', group: 'derivs',
    short: 'The strikes carrying the most put and call open interest.',
    long: 'Heavy put open interest below price is commonly read as support, heavy call open interest '
      + 'above as resistance. Useful as levels other participants are watching.',
    seeAlso: ['maxPain'],
  },
  futBasis: {
    term: 'Futures basis', group: 'derivs',
    short: 'How far the future trades from spot, as a percentage.',
    long: 'A widening premium is usually read as bullish positioning, a discount as bearish. Near '
      + 'expiry it converges to zero by definition, so the reading means less the closer you are.',
    seeAlso: ['rollover', 'daysToExpiry'],
  },
  rollover: {
    term: 'Rollover', group: 'derivs',
    short: 'The share of expiring positions carried into the next series.',
    long: 'High rollover with rising price is read as conviction; high rollover with falling price as '
      + 'conviction the other way. It is only meaningful in the last few sessions before expiry.',
    seeAlso: ['futBasis'],
  },
  expectedMove: {
    term: 'Expected move', group: 'derivs',
    short: 'The at-the-money straddle as a fraction of spot — the market\'s own priced move to expiry.',
    long: 'The most directly useful derivatives number here: it is what option buyers and sellers have '
      + 'agreed is a normal move by expiry. Compare it against the projection cone, which is derived '
      + 'from past volatility rather than from prices being paid now.',
    seeAlso: ['projection', 'daysToExpiry'],
  },
  daysToExpiry: {
    term: 'Days to expiry', group: 'derivs',
    short: 'Sessions left in the current derivatives series.',
    long: 'Most of the numbers above behave differently in the final week. Basis converges, rollover '
      + 'becomes meaningful, and max pain exerts more pull.',
    seeAlso: ['futBasis', 'rollover'],
  },

  // ── News ──────────────────────────────────────────────────────────────────
  sentiment: {
    term: 'Sentiment', group: 'news',
    short: 'The scored tone of recent headlines, negative through positive.',
    long: 'A lexicon score over headline text, not an understanding of the news. Useful for noticing '
      + 'that something is being talked about; not evidence about what price will do.',
    seeAlso: ['newsNotBacktestable'],
  },
  dominantEvent: {
    term: 'Dominant event', group: 'news',
    short: 'The event type most present in the headlines — results, rating, deal, legal.',
    long: 'Classified from the text. It tells you what KIND of news is around, which often matters more '
      + 'than its tone.',
    seeAlso: ['sentiment'],
  },
  newsNotBacktestable: {
    term: 'Why news is NOT BACKTESTABLE', group: 'news',
    short: 'No free feed carries enough history to measure whether tone predicts anything.',
    long: 'So Rāma shows news as context and refuses to include it in a backtest. Labelling it rather '
      + 'than quietly mixing it into a result is the difference between a limitation you know about '
      + 'and a number you cannot trust.',
    seeAlso: ['notBacktestable'],
  },
};

export const termIds = () => Object.keys(TERMS);

export function term(id) {
  return Object.prototype.hasOwnProperty.call(TERMS, id) ? TERMS[id] : null;
}

/** Terms in one group, alphabetically by display name. */
export function termsInGroup(groupId) {
  return Object.entries(TERMS)
    .filter(([, t]) => t.group === groupId)
    .map(([id, t]) => ({ id, ...t }))
    .sort((a, b) => a.term.localeCompare(b.term));
}

/**
 * Free-text search over term, short and long.
 *
 * Ranked so an exact name match cannot end up below a passing mention in someone else's definition —
 * a glossary that buries the word you typed is worse than an index.
 */
export function searchTerms(query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return Object.entries(TERMS).map(([id, t]) => ({ id, ...t, score: 0 }));
  const out = [];
  for (const [id, t] of Object.entries(TERMS)) {
    const name = t.term.toLowerCase();
    let score = 0;
    if (name === q) score = 100;
    else if (name.startsWith(q)) score = 80;
    else if (name.includes(q)) score = 60;
    else if (t.short.toLowerCase().includes(q)) score = 40;
    else if (t.long.toLowerCase().includes(q)) score = 20;
    if (score === 0) continue;
    out.push({ id, ...t, score });
  }
  out.sort((a, b) => (b.score - a.score) || a.term.localeCompare(b.term));
  return out;
}
