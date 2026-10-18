/**
 * evolveModel.js - what the EVOLVE tab says, as data (spec Section 151)
 *
 * The tab is mostly sentences, and a sentence that overclaims is the defect this feature exists to avoid.
 * So every sentence the tab can say about a candidate or a kept strategy is made HERE, from the engine's
 * figures, in plain functions that `scripts/verifyEvolve.mjs` can drive with awkward input. The component
 * only lays them out.
 *
 * THE RULES THIS FILE HOLDS
 *   - A candidate that is not `demonstrated` is called NOT DEMONSTRATED, loudly, wherever it appears. A
 *     profitable-after-costs row is listed because master ruled that profit gates the list (Section 135);
 *     being listed is not being recommended.
 *   - Figures that describe the past say so. A hit rate is never "the chance the next trade wins".
 *   - A missing figure is a dash, never zero and never "0%".
 *   - Nothing here is worded as an instruction: no buy, no sell, no order. A rule's state is described.
 *   - A strategy that is decaying is PROPOSED for retirement; nothing here retires it.
 */

export const DEMONSTRATED = 'demonstrated';
export const UNPROVEN = 'unproven';
export const REFUSED = 'refused';

const finite = (v) => typeof v === 'number' && Number.isFinite(v);

export const pct = (v, dp = 0) => (finite(v) ? `${(v * 100).toFixed(dp)}%` : '—');
export const pctRaw = (v, dp = 2) => (finite(v) ? `${v >= 0 ? '+' : ''}${v.toFixed(dp)}%` : '—');
export const num = (v, dp = 2) => (finite(v) ? v.toFixed(dp) : '—');
export const int = (v) => (finite(v) ? Math.round(v).toLocaleString('en-IN') : '—');

/** The class a row may be called. Anything the engine did not stamp is treated as the weakest claim. */
export function classOf(row) {
  const c = row && row.verdictClass;
  return c === DEMONSTRATED || c === UNPROVEN || c === REFUSED ? c : UNPROVEN;
}

export const CLASS_LABEL = {
  [DEMONSTRATED]: 'DEMONSTRATED',
  [UNPROVEN]: 'NOT DEMONSTRATED',
  [REFUSED]: 'NOT RANKED',
};

export const CLASS_SENTENCE = {
  [DEMONSTRATED]: 'Cleared the test for the number of variants tried and beat what the luckiest of its rivals would show on random prices. It still describes the past.',
  [UNPROVEN]: 'Profitable after costs on bars it was not tuned on, but not distinguishable from luck. Listed because profit gates the list, not because it is recommended.',
  [REFUSED]: 'Not ranked.',
};

/** Colour role for a class. Demonstrated is the only one allowed to look good. */
export const CLASS_TONE = { [DEMONSTRATED]: 'good', [UNPROVEN]: 'warn', [REFUSED]: 'muted' };

function foldsText(row) {
  const s = row && row.foldsScored;
  const p = row && row.foldsPositive;
  if (!finite(s) || s <= 0) return null;
  const pos = finite(p) ? p : 0;
  const tail = pos === s ? 'every stretch paid' : pos === 0 ? 'no stretch paid' : pos * 2 < s ? 'a minority of stretches paid' : 'most stretches paid';
  return `Positive in ${pos} of ${s} stretches (${tail}).`;
}

function gapText(row) {
  const ins = row && row.inSampleHitRate;
  const oos = row && row.hitRate;
  if (!finite(ins) || !finite(oos)) {
    return row && row.tuned === false ? 'Used its published settings, so there is no tuning to compare against.' : null;
  }
  const gap = row.hitRateGapPoints;
  const base = `Hit rate ${pct(ins)} on the data it was tuned on, ${pct(oos)} on the data after.`;
  if (row.largeGap) return `${base} A gap of ${Math.abs(gap).toFixed(0)} points means much of the tuned result was fit to history.`;
  return base;
}

/**
 * One ranked candidate as a card. `row` is a `strategy_factory.evolve` ranked row.
 * Every field is a string or null so the component never formats, and so a test can read the lot.
 */
export function rankedView(row) {
  const r = row || {};
  const m = r.measurement || {};
  const klass = classOf(r);
  const claim = r.claim || null;
  return {
    id: r.id,
    name: r.name || r.id || 'Unnamed strategy',
    rank: finite(r.rank) ? r.rank : null,
    klass,
    label: CLASS_LABEL[klass],
    tone: CLASS_TONE[klass],
    sentence: CLASS_SENTENCE[klass],
    hitRate: pct(r.hitRate),
    trades: finite(m.trades) ? String(m.trades) : '—',
    expectancy: finite(m.expectancyPct) ? `${pctRaw(m.expectancyPct)} per trade after costs` : '—',
    payoff: finite(m.payoffRatio) ? `${num(m.payoffRatio)} to 1 reward to risk` : '—',
    drawdown: finite(m.maxDrawdown) ? `${pct(m.maxDrawdown, 1)} deepest drop` : '—',
    chanceReal: finite(m.chanceReal) ? `${pct(m.chanceReal)} that it is not luck` : '—',
    breakeven: finite(m.breakevenWinRate) ? `needs ${pct(m.breakevenWinRate)} to break even` : null,
    selectionNoise: finite(r.selectionNoiseHitRate)
      ? `The luckiest of ${int(r.candidatesCompared)} random strategies would reach about ${pct(r.selectionNoiseHitRate)}; this one ${r.exceedsSelectionNoise ? 'beat that' : 'did not beat that'}.`
      : null,
    folds: foldsText(r),
    gap: gapText(r),
    trials: finite(r.variantsTried)
      ? `${r.variantsTried} ${r.variantsTried === 1 ? 'variant' : 'variants'} tried${r.tuned ? ', tuned on the past only' : ' (its published settings, no tuning)'}.`
      : null,
    fallbacks: finite(r.fallbacks) && r.fallbacks > 0
      ? `${r.fallbacks} ${r.fallbacks === 1 ? 'stretch' : 'stretches'} had too little earlier history to choose from, so the published settings were used.`
      : null,
    claim: claim ? `Published claim, not measured here: ${claim.text || ''} (${claim.source || 'source unnamed'}${claim.year ? `, ${claim.year}` : ''}).` : null,
    disclaimer: 'A hit rate describes the past. It is not the chance the next trade wins.',
    canKeep: klass === DEMONSTRATED || klass === UNPROVEN,
    keepLabel: klass === DEMONSTRATED ? 'Keep' : 'Keep as not demonstrated',
  };
}

/** One row that was not ranked, with the reason, and how much history it would take where that is knowable. */
export function refusedView(row, bucket) {
  const r = row || {};
  const needs = r.needs || null;
  const why = r.reason || r.whyNot || 'It could not be judged on this series.';
  let history = null;
  if (needs && finite(needs.barsNeeded) && finite(needs.barsHave)) {
    history = needs.barsNeeded > needs.barsHave
      ? `At its present trading rate it needs about ${int(needs.barsNeeded)} bars to be judged; ${int(needs.barsHave)} are stored.`
      : `${int(needs.barsHave)} bars are stored, which should be enough; it produced too few trades to rank.`;
  } else if (needs && needs.tradesSoFar === 0) {
    history = 'It made no trades on this series, so there is no rate to estimate how much history it needs.';
  }
  const titles = { insufficient: 'Too few trades to judge', unvalidated: 'No out-of-sample record', excluded: 'Does not pay after costs' };
  return {
    id: r.id,
    name: r.name || r.id || 'Unnamed strategy',
    bucket,
    title: titles[bucket] || 'Not ranked',
    why,
    history,
    label: CLASS_LABEL[REFUSED],
  };
}

/** The whole run as one view: the headline, the cards, the refusals, the cost line. */
export function runView(run) {
  if (!run || run.ok === false) {
    return { ok: false, reason: (run && run.reason) || 'The run did not complete.', storedBars: run && run.storedBars, needBars: run && run.needBars };
  }
  const ranked = (run.ranked || []).map(rankedView);
  const refused = [
    ...(run.insufficient || []).map((x) => refusedView(x, 'insufficient')),
    ...(run.unvalidated || []).map((x) => refusedView(x, 'unvalidated')),
    ...(run.excluded || []).map((x) => refusedView(x, 'excluded')),
  ];
  const counts = run.counts || {};
  const nDemo = ranked.filter((c) => c.klass === DEMONSTRATED).length;
  let headline;
  if (nDemo > 0) {
    headline = `${nDemo} of ${ranked.length + refused.length} strategies ${nDemo === 1 ? 'was' : 'were'} demonstrated on ${run.symbol}. ${ranked.length - nDemo} more ${ranked.length - nDemo === 1 ? 'is' : 'are'} profitable so far but not demonstrated.`;
  } else if (ranked.length > 0) {
    headline = `None of the ${ranked.length + refused.length} strategies was demonstrated on ${run.symbol}. ${ranked.length} ${ranked.length === 1 ? 'is' : 'are'} profitable after costs so far, which on random prices also happens by luck.`;
  } else {
    headline = `Nothing was ranked on ${run.symbol}. That is an answer: no strategy in the library showed an out-of-sample profit after costs on these bars.`;
  }
  const cb = run.costBasis || {};
  const cost = cb.source === 'measured'
    ? `Costs: real brokerage and statutory charges at the size each strategy would take, judged under the highest of them (${num(cb.runRoundTripPct, 3)}% a round trip), plus your slippage and spread.`
    : `Costs: flat percentages (${num(cb.runRoundTripPct, 3)}% a round trip). ${cb.why || ''}`.trim();
  return {
    ok: true,
    runId: run.runId,
    headline,
    ranked,
    refused,
    nDemonstrated: nDemo,
    canKeepAll: nDemo > 0,
    cost,
    window: `${int(run.bars)} ${run.interval} bars, ${run.firstBar} to ${run.lastBar}.`,
    familyTrials: finite(run.familyTrials) ? `${int(run.familyTrials)} variants were tried in all.` : null,
    refusedTemplates: (run.refused || []).map((x) => `${x.template}: ${x.reason}`),
    notes: run.notes || [],
    counts,
    seconds: run.seconds,
  };
}

// ─── The book ─────────────────────────────────────────────────────────────────

export const STATUS_LABEL = { watch: 'WATCH', holding: 'HOLDING', decaying: 'DECAYING', retired: 'RETIRED' };
export const STATUS_TONE = { watch: 'muted', holding: 'good', decaying: 'bad', retired: 'muted' };
export const STATUS_SENTENCE = {
  watch: 'Not enough fresh trades yet to say, or profitable so far but not distinguishable from luck.',
  holding: 'Ten or more trades since it was kept, positive after costs, and unlikely to be chance.',
  decaying: 'Ten or more trades since it was kept that do not pay after costs.',
  retired: 'Retired by you. Kept in the history, hidden from the list.',
};

/** The three columns of a kept strategy. Claim, baseline and current are never merged. */
export function bookEntryView(entry, signal) {
  const e = entry || {};
  const b = e.baseline || {};
  const bo = b.outOfSample || {};
  const cur = e.current || null;
  const cv = cur && cur.verdict ? cur.verdict : null;
  const status = STATUS_LABEL[e.status] ? e.status : 'watch';
  const klass = b.verdictClass === DEMONSTRATED ? DEMONSTRATED : UNPROVEN;
  const proposeRetire = status === 'decaying';
  return {
    id: e.id,
    name: e.name || e.template || 'Unnamed strategy',
    where: [e.symbol, e.exchange, e.interval].filter(Boolean).join(' · '),
    status,
    statusLabel: STATUS_LABEL[status],
    statusTone: STATUS_TONE[status],
    statusSentence: STATUS_SENTENCE[status],
    klass,
    classLabel: CLASS_LABEL[klass],
    classTone: CLASS_TONE[klass],
    stale: !!e.stale,
    claim: e.claim ? `${e.claim.text || ''} (${e.claim.source || 'source unnamed'}${e.claim.year ? `, ${e.claim.year}` : ''}). Published, not measured here.` : 'No published claim is attached.',
    baseline: {
      title: 'When you kept it',
      on: b.measuredOn ? String(b.measuredOn).slice(0, 10) : '—',
      hitRate: pct(bo.win_rate),
      trades: finite(bo.trades) ? String(bo.trades) : '—',
      expectancy: finite(bo.expectancy_pct) ? pctRaw(bo.expectancy_pct) : '—',
    },
    current: cur
      ? {
        title: 'Since then',
        on: cur.measuredOn ? String(cur.measuredOn).slice(0, 10) : '—',
        bars: finite(cur.forwardBars) ? `${int(cur.forwardBars)} bars after it was kept` : '—',
        hitRate: cv ? pct(cv.win_rate) : '—',
        trades: finite(cur.forwardTrades) ? String(cur.forwardTrades) : '0',
        expectancy: cv && finite(cv.expectancy_pct) ? pctRaw(cv.expectancy_pct) : '—',
        note: cur.forwardBars === 0
          ? 'No bars have arrived since it was kept. Fetch newer bars to test it.'
          : (cur.forwardTrades || 0) < 10
            ? `${cur.forwardTrades || 0} of the 10 trades needed before this means anything.`
            : null,
      }
      : { title: 'Since then', on: '—', bars: '—', hitRate: '—', trades: '—', expectancy: '—', note: 'Not yet measured on newer bars.' },
    proposeRetire,
    retireProposal: proposeRetire
      ? 'Rāma proposes retiring this: the bars since you kept it do not pay after costs. It has not retired it. That is your decision.'
      : null,
    signal: signalView(signal, e.interval),
  };
}

const AGE_WARN_DAYS = { '1d': 4, '1wk': 10, '1mo': 40 };

/**
 * What the kept rule says on its last stored bar. A DESCRIPTION OF THE RULE: never an instruction, so the
 * words buy, sell and order do not appear. Age is always present because a state read from stale bars is a
 * statement about the past.
 */
export function signalView(sig, interval) {
  if (!sig) return { state: 'unknown', label: 'NOT READ', text: 'The rule has not been read yet.', age: null, stale: false, levels: null };
  const age = finite(sig.barAgeDays) ? sig.barAgeDays : null;
  const limit = AGE_WARN_DAYS[interval || sig.interval] ?? 4;
  const stale = age !== null && age > limit;
  const ageText = age === null ? null : `Last stored bar: ${sig.lastBar} (${age} ${age === 1 ? 'day' : 'days'} old).${stale ? ' Fetch newer bars; this reading is about the past.' : ''}`;
  if (sig.state === 'in-trade') {
    return {
      state: 'in-trade',
      label: 'IN A TRADE',
      text: `The rule would be holding a position entered ${sig.entryDate} at ${num(sig.entryPrice)}, ${sig.barsHeld} ${sig.barsHeld === 1 ? 'bar' : 'bars'} ago.`,
      levels: `Stop ${num(sig.stopPrice)} · target ${num(sig.targetPrice)} · now ${pctRaw(sig.unrealisedPct)} from entry`,
      sizing: sizingText(sig),
      age: ageText, stale,
    };
  }
  if (sig.state === 'conditions-met') {
    return {
      state: 'conditions-met',
      label: 'CONDITIONS MET',
      text: 'The entry conditions hold on the last close. A fill would be at the next bar open, so these levels are indicative.',
      levels: `Stop about ${num(sig.indicativeStop)} · target about ${num(sig.indicativeTarget)}`,
      sizing: sig.unsized ? 'Its risk budget sizes below one unit at this price.' : sizingText(sig),
      age: ageText, stale,
    };
  }
  return {
    state: 'flat',
    label: 'FLAT',
    text: sig.reason ? `Not read: ${sig.reason}.` : 'The entry conditions do not hold on the last close.',
    levels: null, sizing: null, age: ageText, stale,
  };
}

function sizingText(sig) {
  if (!finite(sig.units) || sig.units <= 0) return null;
  return sig.lots ? `Sized by your risk budget: ${int(sig.units)} units (${sig.lots} ${sig.lots === 1 ? 'lot' : 'lots'}).` : `Sized by your risk budget: ${int(sig.units)} units.`;
}

/** The count line above the book. */
export function bookSummary(view) {
  const c = (view && view.counts) || {};
  const total = (c.watch || 0) + (c.holding || 0) + (c.decaying || 0);
  if (total === 0) return 'Your book is empty. Evolve strategies above and keep the ones you want to follow.';
  const parts = [];
  if (c.holding) parts.push(`${c.holding} holding`);
  if (c.watch) parts.push(`${c.watch} on watch`);
  if (c.decaying) parts.push(`${c.decaying} decaying`);
  return `${total} kept: ${parts.join(', ')}.`;
}

/**
 * Should opening the tab refresh the book? Only when master can request, the bridge exists and something is
 * stale. This is the single place that decides it, because "refresh on open" is the only automatic thing the
 * tab does and it must not creep (Section 151.5: no timer).
 */
export function shouldRefreshOnOpen({ canRequest, inBridge, staleIds, busy }) {
  return !!canRequest && !!inBridge && !busy && Array.isArray(staleIds) && staleIds.length > 0;
}

/** The request for an evolve run, or the one reason it cannot be made. */
export function evolveRequest({ symbol, exchange, interval, capital, riskPct, side, wider }) {
  if (!symbol) return { ok: false, reason: 'Pick an instrument first.' };
  if (!(Number(capital) > 0)) return { ok: false, reason: 'Capital must be above zero.' };
  const risk = Number(riskPct);
  if (!(risk > 0 && risk <= 10)) return { ok: false, reason: 'Risk per trade must be above 0% and at most 10%.' };
  return {
    ok: true,
    body: {
      symbol, exchange: exchange || 'NSE', interval: interval || '1d', capital: Number(capital), riskPct: risk,
      side: side === 'long' || side === 'short' ? side : 'both', explore: wider ? 'wider' : 'library',
    },
  };
}

/** Why the EVOLVE button is disabled, as one sentence, so a greyed button is never a mystery. */
export function whyCannotEvolve({ inBridge, canRequest, busy, symbol }) {
  if (!inBridge) return 'Strategies can only be evolved in the desktop app.';
  if (!canRequest) return 'Your account can read the book but not run searches.';
  if (busy) return 'A search is running.';
  if (!symbol) return 'Pick an instrument first.';
  return null;
}

/** Words the tab must never put in front of master (Section 95). Exposed so the suite can scan the output. */
export const FORBIDDEN_WORDS = ['buy', 'sell', 'order'];
