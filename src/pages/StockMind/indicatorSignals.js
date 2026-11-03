/**
 * indicatorSignals.js — turning the chart's studies into vote columns a measurement can judge
 * (spec Section 172).
 *
 * WHAT THIS IS FOR. `indicator_attribution.py` measures which indicator actually contributes, but it
 * takes signal columns and forward returns from its caller and computes neither. This is the caller.
 * Without it the measurement engine has no path from real candles and is unreachable code — the
 * defect this project has already found twice (`functionTracking` sat with zero call sites for three
 * sections; `models:roles` was registered, gated, and named in neither preload nor `src/`).
 *
 * WHY HERE AND NOT IN PYTHON. The engine side has no series indicators at all — `features.py`
 * returns one row of scalars for the LAST bar and needs numpy. The series maths lives here, in
 * `indicators.js`, dependency-free and already discriminated against its own lookalikes by
 * `verifyIndicators.mjs`. Porting RSI, EMA and MACD into Python would be a FOURTH copy of each, and
 * Section 69 exists because two code paths once assembled "the same" vector differently. So this
 * module adds no indicator arithmetic whatever: every series comes from `OVERLAY_DEFS`.
 *
 * THE TWO RULES THAT MAKE THE MEASUREMENT HONEST, and they are enforced here because this is the
 * only place that sees both sides:
 *
 *   CAUSAL     the vote at bar `i` is computed from bars up to and including `i`, never beyond.
 *   FUTURE     `forwardReturns[i]` is the move from bar `i` to bar `i+1`, strictly after the vote.
 *
 * The final bar has no known forward return, so it is DROPPED rather than filled with a zero. A
 * zero there is a free correct answer on the most recent bar, which is the bar a reader cares most
 * about — the flattering error, and silent.
 *
 * A VOTE RULE IS A HYPOTHESIS, NOT A FACT. "RSI below 30 is bullish" is a choice; the opposite
 * choice is equally expressible. So each rule is declared as DATA with its own threshold grid, and a
 * caller searching over rules must count each one as a trial — see `gridSize`. Nothing here decides
 * which rule is right; that is what the measurement is for.
 */

import { OVERLAY_DEFS, overlayById, resolveParams, needsFor } from './indicators.js';
import { INTERVALS, SESSION_MINUTES } from './timeframes.js';

/** A bar with no reading yet. Matches `indicator_attribution.ABSTAIN`: absence is not a vote of zero. */
export const ABSTAIN = null;

const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const key = (t) => String(t);

/**
 * Candidate values per numeric parameter when searching "from data alone".
 *
 * NOT the full declared range. `OVERLAY_DEFS` allows an SMA period from 1 to 500, and enumerating it
 * would be 500 trials for one study and ~10^7 for a four-study combination — a search so large that
 * the deflation it has to be charged would reject everything, which is the correct outcome and a
 * waste of a day's compute to reach. A coarse grid is a smaller, honest search.
 */
export const GRID_POINTS = 5;

/**
 * Evenly spaced candidates for one parameter field, centred on what the study ships with.
 *
 * Centred on the default rather than on the midpoint of the declared range, because the shipped
 * value is the one with a literature behind it; the grid asks "is the conventional setting right for
 * THIS instrument", which is master's question, rather than wandering the whole legal interval.
 */
export function gridFor(field, points = GRID_POINTS) {
  if (!field || !finite(field.default)) return [];
  const n = Math.max(1, Math.floor(points));
  if (n === 1) return [field.default];
  const isInt = field.kind !== 'float';
  const step = finite(field.step) && field.step > 0 ? field.step : (isInt ? 1 : 0.1);
  // Spacing scales with the default so a 200-period average is not probed in steps of one.
  const spread = Math.max(1, Math.round(field.default / (step * 8)) || 1);
  const half = Math.floor(n / 2);
  const out = [];
  // BOUNDED BY CONSTRUCTION: k runs a fixed range. The first version looped until it had `n`
  // candidates with the bail-out AFTER the range checks, so a `continue` on an out-of-bounds value
  // skipped the bail-out and a narrow field — min 18, max 22, default 20 — spun forever. A loop
  // whose termination depends on reaching a target count is the wrong shape here: a field that
  // cannot supply `n` distinct candidates should return fewer, not hang.
  for (let k = -half; k <= half; k += 1) {
    const raw = field.default + k * step * spread;
    const v = isInt ? Math.round(raw) : Math.round(raw * 1000) / 1000;
    if (v < field.min || v > field.max) continue;
    if (!out.includes(v)) out.push(v);
  }
  return out.sort((a, b) => a - b);
}

// ─── The vote rules, declared as data ──────────────────────────────────────────────────────────────
/**
 * One rule per study the chart already offers. `read` receives the study's output and the bars, and
 * returns a vote in [-1, +1] for each bar or `ABSTAIN` where the study has no reading.
 *
 * `thresholds` are the rule's OWN parameters, separate from the study's. An RSI rule has a period
 * (the study's) and an oversold level (the rule's), and conflating them would hide half the search.
 */
export const SIGNAL_RULES = Object.freeze([
  {
    id: 'rsi-reversion', overlay: 'rsi14', kind: 'mean-reversion',
    label: 'RSI oversold/overbought',
    why: 'Below the low threshold is read as bullish and above the high as bearish. The opposite '
      + 'reading — RSI as momentum confirmation — is a different hypothesis and is not assumed here.',
    thresholds: [
      { key: 'low', label: 'Oversold', kind: 'int', min: 5, max: 45, step: 5, default: 30 },
      { key: 'high', label: 'Overbought', kind: 'int', min: 55, max: 95, step: 5, default: 70 },
    ],
    read: (series, bars, t) => atTime(series, bars, (v) => (v < t.low ? 1 : (v > t.high ? -1 : 0))),
  },
  {
    id: 'sma20-trend', overlay: 'sma20', kind: 'trend', label: 'Close vs SMA 20',
    why: 'Close above the average is read as bullish. The simplest trend statement there is.',
    thresholds: [],
    read: (series, bars) => crossAbove(series, bars),
  },
  {
    id: 'sma50-trend', overlay: 'sma50', kind: 'trend', label: 'Close vs SMA 50',
    why: 'The same statement as SMA 20 over a slower window, included separately so the measurement '
      + 'can say whether the longer window carries anything the shorter one does not.',
    thresholds: [],
    read: (series, bars) => crossAbove(series, bars),
  },
  {
    id: 'sma200-trend', overlay: 'sma200', kind: 'trend', label: 'Close vs SMA 200',
    why: 'The conventional long-term regime line. It abstains for its first 199 bars, which is a '
      + 'real cost on short histories and the reason abstention is reported per rule.',
    thresholds: [],
    read: (series, bars) => crossAbove(series, bars),
  },
  {
    id: 'ema21-trend', overlay: 'ema21', kind: 'trend', label: 'Close vs EMA 21',
    why: 'As the SMA rules, with recent bars weighted more heavily.',
    thresholds: [],
    read: (series, bars) => crossAbove(series, bars),
  },
  {
    id: 'macd-histogram', overlay: 'macd', kind: 'momentum', label: 'MACD histogram sign',
    why: 'A positive histogram means the MACD line is above its signal. Read as momentum, not as a '
      + 'level, so only the SIGN is used and the magnitude is deliberately discarded.',
    thresholds: [],
    read: (out, bars) => atTime(out?.histogram, bars, (v) => (v > 0 ? 1 : (v < 0 ? -1 : 0))),
  },
  {
    id: 'bollinger-reversion', overlay: 'bb', kind: 'mean-reversion', label: 'Close outside Bollinger band',
    why: 'Close below the lower band is read as bullish. Note this is the OPPOSITE reading to a '
      + 'breakout interpretation of the same band, which is why the measurement has to settle it.',
    thresholds: [],
    read: (out, bars) => {
      const up = indexOf(out?.upper);
      const lo = indexOf(out?.lower);
      return bars.map((b) => {
        const u = up.get(key(b.time));
        const l = lo.get(key(b.time));
        if (!finite(u) || !finite(l) || !finite(b.close)) return ABSTAIN;
        return b.close < l ? 1 : (b.close > u ? -1 : 0);
      });
    },
  },
  {
    id: 'vwap-side', overlay: 'vwap', kind: 'trend', label: 'Close vs session VWAP',
    why: 'Which side of the session average price the bar closed on. Intraday only — VWAP resets '
      + 'each session, so on daily bars the study returns nothing and this abstains throughout.',
    thresholds: [], intradayOnly: true,
    read: (series, bars) => crossAbove(series, bars),
  },
]);

export const ruleById = (id) => SIGNAL_RULES.find((r) => r.id === id) || null;
export const RULE_IDS = Object.freeze(SIGNAL_RULES.map((r) => r.id));

// ─── helpers shared by the rules ───────────────────────────────────────────────────────────────────
function indexOf(series) {
  const m = new Map();
  for (const pt of Array.isArray(series) ? series : []) {
    if (finite(pt?.value)) m.set(key(pt.time), pt.value);
  }
  return m;
}

/** Map a single-series study onto the bars, voting with `fn`, abstaining where it has no reading. */
function atTime(series, bars, fn) {
  const at = indexOf(series);
  return bars.map((b) => {
    const v = at.get(key(b.time));
    return finite(v) ? fn(v) : ABSTAIN;
  });
}

/** +1 when the close is above the line, -1 below. The trend rules' shared body. */
function crossAbove(series, bars) {
  const at = indexOf(series);
  return bars.map((b) => {
    const v = at.get(key(b.time));
    if (!finite(v) || !finite(b.close)) return ABSTAIN;
    return b.close > v ? 1 : (b.close < v ? -1 : 0);
  });
}

function resolvedThresholds(rule, stored) {
  const src = (stored && typeof stored === 'object') ? stored : {};
  const out = {};
  for (const f of rule.thresholds || []) {
    // `Number(null)` is 0 and `Number('')` is 0, both finite — so a null threshold used to pass the
    // finite test, arrive as zero, and get CLAMPED TO THE FIELD MINIMUM instead of falling back to
    // the default. An overbought level silently becoming 55 is a different rule wearing the same
    // name. Only an actual number is accepted.
    const given = src[f.key];
    const raw = typeof given === 'number' ? given : NaN;
    const v = Number.isFinite(raw) ? raw : f.default;
    out[f.key] = f.kind === 'float'
      ? Math.min(f.max, Math.max(f.min, v))
      : Math.round(Math.min(f.max, Math.max(f.min, v)));
  }
  return out;
}

// ─── forward returns ───────────────────────────────────────────────────────────────────────────────
/**
 * The move from each bar to the NEXT one, as a percentage. One shorter than `bars`, by construction.
 *
 * This is the only future-looking quantity in the module and it is the one the measurement is judged
 * against. The last bar is absent rather than zero: a zero would be a free correct answer on the most
 * recent bar, which flatters the result exactly where a reader is paying most attention.
 */
export function forwardReturns(bars) {
  const src = Array.isArray(bars) ? bars : [];
  const out = [];
  for (let i = 0; i + 1 < src.length; i += 1) {
    const a = src[i]?.close;
    const b = src[i + 1]?.close;
    out.push(finite(a) && finite(b) && a !== 0 ? ((b - a) / a) * 100 : 0);
  }
  return out;
}

// ─── the matrix the engine consumes ────────────────────────────────────────────────────────────────
/**
 * Vote columns plus forward returns, aligned, ready for `indicator_attribution.attribute`.
 *
 * @param {Array}  bars      OHLC bars, oldest first
 * @param {Array}  ruleIds   which rules to build columns for; defaults to every rule
 * @param {object} opts      `{ params: {ruleId: {...study params}}, thresholds: {ruleId: {...}},
 *                             intradayInterval: boolean }`
 * @returns {{ok, reason, signals, forwardReturns, bars, abstained, skipped}}
 *          `signals[ruleId][i]` aligns with `forwardReturns[i]`, both of length `bars.length - 1`.
 */
export function signalMatrix(bars, ruleIds = RULE_IDS, opts = {}) {
  // `interval` is the canonical id from `timeframes.js` and is the preferred input, because it says
  // WHICH timeframe rather than only whether it is intraday. The older `intradayInterval` boolean is
  // still honoured so existing callers keep working (I11: upgrades are additive); when both are
  // given the interval wins, since it is the more specific fact.
  const meta = intervalMeta(opts.interval);
  const intraday = meta ? !!meta.intraday : !!opts.intradayInterval;
  const context = {
    symbol: opts.symbol ? String(opts.symbol).toUpperCase() : null,
    exchange: String(opts.exchange || 'NSE').toUpperCase(),
    interval: meta ? meta.id : null,
    intraday,
    barsPerSession: meta ? barsPerSession(meta.id) : null,
    // Null when the caller named no instrument or interval. A null key is honest: it says this
    // result cannot be stored and shown later, because there is nothing to check it against.
    key: opts.symbol && meta ? measurementKey(opts.symbol, opts.exchange, meta.id) : null,
  };

  const src = (Array.isArray(bars) ? bars : []).filter((b) => b && finite(b.close));
  if (src.length < 3) {
    return { ok: false, reason: `${src.length} usable bars; a forward return needs at least 3`,
      signals: {}, forwardReturns: [], bars: [], abstained: {}, skipped: [], context };
  }

  const fwd = forwardReturns(src);
  // Every column is cut to the forward returns' length, so the LAST bar — the one with no known
  // future — cannot reach the measurement through any path.
  const judged = src.slice(0, fwd.length);

  const signals = {};
  const abstained = {};
  const skipped = [];

  for (const id of Array.isArray(ruleIds) ? ruleIds : []) {
    const rule = ruleById(id);
    if (!rule) { skipped.push({ id, why: 'no such rule' }); continue; }
    if (rule.intradayOnly && !intraday) {
      skipped.push({ id, why: `the study it reads is intraday-only and ${context.interval || 'these'} bars are not intraday` });
      continue;
    }
    const def = overlayById(rule.overlay);
    if (!def) { skipped.push({ id, why: `no study ${rule.overlay}` }); continue; }

    const params = resolveParams(rule.overlay, (opts.params || {})[id]);
    const need = needsFor(rule.overlay, params);
    if (need && src.length < need) {
      skipped.push({ id, why: `${rule.overlay} needs ${need} bars at these parameters and there are ${src.length}` });
      continue;
    }

    let column;
    try {
      const series = def.make(src, params);
      const t = resolvedThresholds(rule, (opts.thresholds || {})[id]);
      column = rule.read(series, judged, t);
    } catch (err) {
      skipped.push({ id, why: `the study threw: ${err?.message ?? String(err)}` });
      continue;
    }
    if (!Array.isArray(column) || column.length !== judged.length) {
      skipped.push({ id, why: 'the rule returned a column that does not align with the bars' });
      continue;
    }
    // A column that abstains on every bar carries no information and would occupy a slot in the
    // combination search while contributing nothing. Reported as skipped rather than measured.
    const voted = column.filter((v) => v !== ABSTAIN).length;
    if (voted === 0) { skipped.push({ id, why: 'it abstained on every bar' }); continue; }

    signals[id] = column;
    abstained[id] = judged.length - voted;
  }

  return {
    ok: Object.keys(signals).length > 0,
    reason: Object.keys(signals).length ? null : 'no rule produced a usable column',
    signals,
    forwardReturns: fwd,
    bars: judged,
    abstained,
    skipped,
    // Travels with the result so a weighting can never be rendered against a different instrument
    // or timeframe than the one it was measured on.
    context,
  };
}

/**
 * How many candidates a parameter search over these rules would examine.
 *
 * EXISTS SO THE TRIAL COUNT CAN BE DECLARED HONESTLY. `indicator_attribution.attribute` takes
 * `extra_trials` for searching done outside it, and a caller that tunes periods and thresholds
 * without declaring them is hiding the search from its own judge. This is that number.
 */
export function gridSize(ruleIds = RULE_IDS, points = GRID_POINTS) {
  let total = 0;
  for (const id of Array.isArray(ruleIds) ? ruleIds : []) {
    const rule = ruleById(id);
    if (!rule) continue;
    const def = overlayById(rule.overlay);
    let n = 1;
    for (const f of (def?.params || [])) n *= Math.max(1, gridFor(f, points).length);
    for (const f of (rule.thresholds || [])) n *= Math.max(1, gridFor(f, points).length);
    total += n;
  }
  return total;
}

/** Every rule that can be built on this interval, so a caller does not offer one that must abstain. */
export function rulesFor(intradayInterval) {
  return SIGNAL_RULES.filter((r) => !r.intradayOnly || intradayInterval);
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// DYNAMIC BY TIMEFRAME AND INSTRUMENT
//
// Master: *"It needs to be dynamic based on time-frame and item selected."*
//
// Two different obligations hide in that sentence, and only one of them is about parameters.
//
// 1. WHAT IS MEASURABLE CHANGES WITH THE TIMEFRAME. VWAP means nothing on daily bars. A 200-period
//    average needs 200 bars, and a day of 5-minute bars supplies 75. Which rules can even be built,
//    and over what parameter range, is a function of the interval and the history actually held —
//    so it is computed per request rather than fixed in the catalogue.
//
// 2. A MEASUREMENT BELONGS TO ONE (INSTRUMENT, INTERVAL) PAIR AND MUST NEVER BE SHOWN FOR ANOTHER.
//    This is the more important half, and it is not hypothetical: Section 117 is in this document
//    because a 30-minute chart was shown a cone measured on DAILY bars. A weighting measured on
//    RELIANCE daily says nothing about TCS on 5-minute bars. So every result carries a `key`, and
//    the key is checked rather than trusted.
//
// WHAT IS DELIBERATELY *NOT* RESCALED: the conventional periods. RSI 14 and SMA 20/50/200 are stated
// in BARS, and practitioners apply the same bar counts on every timeframe — that is what the
// literature measured. Silently turning RSI 14 into RSI 1050 on 5-minute bars to preserve a
// wall-clock window would be imposing a theory nobody asked for and would make the defaults
// incomparable with every published result. The GRID moves with the timeframe; the CENTRE does not.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

/** The canonical interval record, or null. Read from `timeframes.js` so there is one such list. */
export function intervalMeta(id) {
  return INTERVALS.find((i) => i.id === String(id)) || null;
}

/**
 * Bars in one trading session at this interval: 1 for daily, 75 for 5-minute, 0.2 for weekly.
 *
 * `span` is in SESSION minutes, which is why one division works for every interval — the reason
 * `timeframes.js` chose that unit rather than wall-clock.
 */
export function barsPerSession(id) {
  const meta = intervalMeta(id);
  if (!meta || !(meta.span > 0)) return null;
  return SESSION_MINUTES / meta.span;
}

/**
 * The identity of a measurement: instrument, venue and interval.
 *
 * EXISTS SO A RESULT CANNOT BE SHOWN AGAINST THE WRONG THING. Returned with every matrix and
 * intended to be stored beside any weighting, so a panel can refuse to render a stale one instead
 * of quietly relabelling it (Section 117's defect, in a new place).
 */
export function measurementKey(symbol, exchange = 'NSE', interval = '1d') {
  const sym = String(symbol || '').trim().toUpperCase();
  const exc = String(exchange || 'NSE').trim().toUpperCase();
  const int = String(interval || '').trim();
  if (!sym || !int) return null;
  return `${exc}:${sym}@${int}`;
}

/** Whether a stored result may be shown for this request. Equality, stated as a function so the */
/** comparison lives in one place rather than being re-derived by every caller. */
export function keyMatches(storedKey, symbol, exchange, interval) {
  const want = measurementKey(symbol, exchange, interval);
  return !!want && String(storedKey || '') === want;
}

/**
 * What can actually be measured for this instrument, on this timeframe, with this much history.
 *
 * @returns `{ok, key, interval, intraday, barsPerSession, usable[], unusable[], trials, warnings[]}`
 *          `usable` carries each rule's grid AT THIS BAR COUNT, so the candidate list a search will
 *          enumerate is the one the data can support rather than the one the catalogue declares.
 */
export function plan({ symbol, exchange = 'NSE', interval = '1d', barCount = 0, points = GRID_POINTS } = {}) {
  const meta = intervalMeta(interval);
  const key = measurementKey(symbol, exchange, interval);
  const out = {
    ok: false, key, interval: String(interval || ''), intraday: !!meta?.intraday,
    barsPerSession: barsPerSession(interval), barCount: Math.max(0, Math.floor(barCount) || 0),
    usable: [], unusable: [], trials: 0, warnings: [],
  };
  if (!meta) { out.unusable.push({ id: '*', why: `unknown interval ${String(interval)}` }); return out; }
  if (!key) { out.unusable.push({ id: '*', why: 'no instrument selected' }); return out; }

  const perSession = out.barsPerSession;

  for (const rule of SIGNAL_RULES) {
    if (rule.intradayOnly && !meta.intraday) {
      out.unusable.push({ id: rule.id, why: `${rule.label} is intraday-only and ${interval} bars are not intraday` });
      continue;
    }
    const def = overlayById(rule.overlay);
    if (!def) { out.unusable.push({ id: rule.id, why: `no study ${rule.overlay}` }); continue; }

    // The grid is filtered to candidates THIS history can support. A 200-period average on 120 bars
    // is not a weak candidate, it is an empty series, and offering it would spend a trial on nothing.
    const fields = [...(def.params || []), ...(rule.thresholds || [])];
    const grid = {};
    let combos = 1;
    for (const f of fields) {
      const isStudyParam = (def.params || []).some((p) => p.key === f.key);
      const candidates = gridFor(f, points).filter((v) => {
        if (!isStudyParam) return true;
        const need = needsFor(rule.overlay, { ...resolveParams(rule.overlay, {}), [f.key]: v });
        return !need || out.barCount >= need;
      });
      grid[f.key] = candidates;
      combos *= Math.max(0, candidates.length);
    }
    if (combos === 0) {
      const need = needsFor(rule.overlay, resolveParams(rule.overlay, {}));
      out.unusable.push({ id: rule.id,
        why: `${rule.label} needs about ${need} bars at every candidate setting and there are ${out.barCount}` });
      continue;
    }

    const notes = [];
    // On intraday bars a window longer than one session reaches across the overnight gap, where the
    // price jumps for reasons the study cannot see. Reported rather than prevented: it is a real
    // choice, and master may want it.
    if (meta.intraday && perSession) {
      const longest = Math.max(...Object.entries(grid)
        .filter(([k]) => (def.params || []).some((p) => p.key === k))
        .flatMap(([, v]) => (v.length ? [Math.max(...v)] : [0])), 0);
      if (longest > perSession) {
        notes.push(`its longest candidate spans ${(longest / perSession).toFixed(1)} sessions, so it `
          + 'reaches across overnight gaps');
      }
    }
    out.usable.push({ id: rule.id, label: rule.label, kind: rule.kind, overlay: rule.overlay, grid, combinations: combos, notes });
    out.trials += combos;
  }

  if (meta.intraday && perSession && out.barCount > 0 && out.barCount < perSession) {
    out.warnings.push(`${out.barCount} bars is under one session at ${interval} `
      + `(${Math.round(perSession)} bars), so every result here describes part of a single day`);
  }
  if (out.trials > 0 && out.barCount > 0 && out.trials > out.barCount) {
    out.warnings.push(`the grid would try ${out.trials} candidates against ${out.barCount} bars; `
      + 'more candidates than observations is a search that finds noise, so narrow the rules or widen the history');
  }
  out.ok = out.usable.length > 0;
  if (!out.ok) out.warnings.push('nothing is measurable on this instrument at this interval with this history');
  return out;
}
