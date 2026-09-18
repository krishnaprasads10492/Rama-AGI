/**
 * positionMath.js — the arithmetic behind closing a position, and the arithmetic behind risk.
 *
 * WHY THIS IS ITS OWN MODULE (spec Section 102). Closing a position used `window.prompt`. A native
 * prompt on a real-money action is the worst control in this module: it accepts any string, shows no
 * consequence, offers no quantity so a partial exit was impossible, no date, no fees, and no
 * confirmation of what master is about to realise. He could type `24.50` meaning 2450 and find out
 * afterwards.
 *
 * Replacing it means computing a PREVIEW — what this exit realises, net of fees, against his own
 * recorded stop and target — and a preview shown next to a commit button must be right. So the
 * maths lives here, pure, and is tested. Nothing in this file touches React, IPC or the DOM.
 *
 * Everything returns `null` rather than 0 for "cannot say". A zero P&L preview beside a Close button
 * would read as "this trade breaks even", which is a claim; `null` renders as "—", which is not.
 */

const finite = (v) => typeof v === 'number' && Number.isFinite(v);

/** Parse a number the way a form field supplies it: strings, blanks and junk all included. */
export function num(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s) return null;
  // Thousands separators are what master's own platform prints, so they must not be an error.
  const n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * What closing `quantity` at `price` realises.
 *
 * SIGN IS TAKEN FROM THE POSITION, NOT FROM THE SIDE OF THE EXIT. A negative `netQty` is a short, so
 * its profit runs the other way. Deriving it from the exit side instead would silently invert the
 * P&L on every short.
 *
 * @param {object} position  `{netQty, avgCost}` from the ledger
 * @param {number|string} price exit price
 * @param {number|string} quantity units to close; blank means the whole position
 * @param {number|string} fees exit charges
 * @returns {{ok: boolean, reason: string|null, quantity: number|null, price: number|null,
 *            gross: number|null, net: number|null, pctOnCost: number|null,
 *            partial: boolean, remaining: number|null, isShort: boolean, direction: string}}
 */
export function closePreview(position, price, quantity, fees) {
  const held = num(position?.netQty);
  const cost = num(position?.avgCost);
  const p = num(price);
  const f = num(fees) ?? 0;

  const isShort = finite(held) && held < 0;
  const size = finite(held) ? Math.abs(held) : null;
  const askedRaw = num(quantity);
  const q = askedRaw === null ? size : Math.abs(askedRaw);

  const base = {
    ok: false, reason: null, quantity: q, price: p,
    gross: null, net: null, pctOnCost: null,
    partial: false, remaining: null, isShort,
    direction: isShort ? 'SHORT' : 'LONG',
  };

  if (!finite(held) || held === 0) {
    return { ...base, reason: 'This position has no open quantity.' };
  }
  if (p === null) return { ...base, reason: 'Enter the price you exited at.' };
  if (p <= 0) return { ...base, reason: 'An exit price must be above zero.' };
  if (q === null || q <= 0) return { ...base, reason: 'Enter how many units you closed.' };
  if (q > size) {
    return { ...base, reason: `You hold ${size}. Closing more than that is not a close, `
      + 'it is a new position in the other direction — record that as a separate trade.' };
  }
  if (f < 0) return { ...base, reason: 'Fees cannot be negative.' };
  if (cost === null) {
    return { ...base, reason: 'This position has no average cost recorded, so the realised '
      + 'amount cannot be computed.' };
  }

  // Long: (exit - cost) x qty. Short: (cost - exit) x qty.
  const gross = (isShort ? (cost - p) : (p - cost)) * q;
  const net = gross - f;
  const invested = cost * q;
  const pctOnCost = invested > 0 ? (net / invested) * 100 : null;
  const remaining = size - q;

  return {
    ok: true, reason: null, quantity: q, price: p,
    gross, net, pctOnCost,
    partial: remaining > 0, remaining, isShort,
    direction: isShort ? 'SHORT' : 'LONG',
  };
}

/**
 * How this exit sits against master's own recorded thesis.
 *
 * NOT ADVICE, AND NOT A MODEL. It compares one number he gave Rāma against another number he is
 * typing now, which is arithmetic on his own declarations — the same line Section 101 drew for chart
 * overlays. No engine reading is involved.
 *
 * @returns {Array<{tone: 'good'|'warn'|'info', text: string}>}
 */
export function closeAgainstThesis(position, price) {
  const p = num(price);
  const held = num(position?.netQty);
  if (p === null || !finite(held) || held === 0) return [];
  const isShort = held < 0;
  const stop = num(position?.thesis?.stopPrice);
  const target = num(position?.thesis?.targetPrice);
  const out = [];

  if (target !== null) {
    const reached = isShort ? p <= target : p >= target;
    out.push(reached
      ? { tone: 'good', text: `At or beyond your target of ${target}.` }
      : { tone: 'info', text: `Short of your target of ${target}.` });
  }
  if (stop !== null) {
    const breached = isShort ? p >= stop : p <= stop;
    if (breached) out.push({ tone: 'warn', text: `At or past your stop of ${stop}.` });
  }
  if (stop === null && target === null) {
    out.push({ tone: 'info', text: 'No stop or target was recorded for this position, so there '
      + 'is nothing to compare this exit against.' });
  }
  return out;
}

/**
 * The money behind "RISK %".
 *
 * The field asked for a percentage and showed nothing else, so the number master was actually
 * choosing — how much of his capital is at stake — was left for him to compute in his head on every
 * change. That is the single cheapest improvement in the request form.
 *
 * @returns {{ok: boolean, amount: number|null, capital: number|null, pct: number|null,
 *            perUnit: number|null, units: number|null, reason: string|null}}
 */
export function riskBudget(capital, riskPct, basePrice, stopPrice) {
  const c = num(capital);
  const r = num(riskPct);
  const base = { ok: false, amount: null, capital: c, pct: r, perUnit: null, units: null, reason: null };
  if (c === null || c <= 0) return { ...base, reason: 'Enter the capital you are trading with.' };
  if (r === null || r <= 0) return { ...base, reason: 'Enter the share of capital you will risk.' };
  const amount = c * (r / 100);

  // Position size is only knowable with a stop: risk per unit is the distance to it. Without one,
  // the budget is still reportable and the size is not — reported as null rather than guessed.
  const p = num(basePrice);
  const s = num(stopPrice);
  let perUnit = null;
  let units = null;
  if (p !== null && s !== null && p > 0 && s > 0 && Math.abs(p - s) > 0) {
    perUnit = Math.abs(p - s);
    units = Math.floor(amount / perUnit);
  }
  return { ok: true, amount, capital: c, pct: r, perUnit, units, reason: null };
}

/**
 * Why an action is unavailable, as a sentence rather than a greyed-out button.
 *
 * A disabled control with no stated cause is a dead end: master cannot tell whether Rāma is busy,
 * whether he lacks a permission, or whether a field upstream is empty. Every `disabled` in this
 * module now comes with one of these.
 *
 * @param {object} state `{inElectron, canRequest, busy, symbol, capital, riskPct, lastClose}`
 * @returns {string|null} null when the action is available
 */
export function whyCannotPredict(stateOrNull) {
  // `= {}` only defaults an UNDEFINED argument, and an explicit `null` slips past it — which is what
  // a caller passing `res?.data` supplies on a failed read.
  const state = (stateOrNull && typeof stateOrNull === 'object') ? stateOrNull : {};
  if (!state.inElectron) return 'Signals need the Rāma desktop app — this bridge is unavailable here.';
  if (!state.canRequest) return 'Generating signals needs Operator tier or higher. Your account can '
    + 'read the chart and your book, but not request a new signal.';
  if (state.busy) return 'A request is already running.';
  if (!String(state.symbol || '').trim()) return 'Pick an instrument first.';
  if (num(state.capital) === null || num(state.capital) <= 0) return 'Enter the capital to size '
    + 'against — position sizing has no meaning without it.';
  if (num(state.riskPct) === null || num(state.riskPct) <= 0) return 'Enter the share of capital you '
    + 'are willing to risk.';
  if (num(state.lastClose) === null) return 'Load price history first. The base price is taken from '
    + 'the last stored close rather than typed, so a signal cannot be priced off a stale number.';
  return null;
}
