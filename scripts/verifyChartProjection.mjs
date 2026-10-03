#!/usr/bin/env node
/**
 * verifyChartProjection.mjs — a projected bar is a RANGE, and this is what stops it looking like a
 * bar that traded.
 *
 * WHAT THIS SUBSYSTEM IS FOR. The engine returns a distribution per future bar — a centre and that
 * bar's own sigma — and the chart used to draw five thin lines from it. Master asked for the
 * projection in the candle type he selected, which means turning a distribution into a bar without
 * inventing an open and a close. `chartProjection.js` is that arithmetic; this asserts it.
 *
 * The assertions that matter most:
 *   - THE BODY IS THE INTERQUARTILE RANGE of the engine's own spread, and it is strictly inside the
 *     wicks for every sigma and every horizon. Asserted numerically, not reasoned about.
 *   - `open` IS ALWAYS THE LOWER VALUE, so a projected bar can never read as a down bar.
 *   - NO GREEN, NO RED, AND `upColor === downColor`. A directional colour on a range is a claim the
 *     engine never made, and the pixels cannot be reached without a screen — so it is pinned at
 *     source level instead.
 *   - HEIKIN-ASHI IS REFUSED and the refusal is RENDERED, because an HA open is an average of real
 *     bars and each HA bar depends on the previous HA close.
 *   - THE CAP IS SURFACED. `capped` and `maxBarsAhead` have been on the cone object all along and
 *     nothing read them, so a horizon the engine shortened looked like the one master chose.
 *   - MAX_BARS_AHEAD AGREES WITH THE PYTHON, parsed from source — the drift test, same precedent
 *     `verifyTimeframes.mjs` set against `providers.py`.
 *   - THE TWO EXISTING SUITES ARE PROTECTED: still exactly two `attachPrimitive` calls and exactly
 *     one `timeScale().fitContent()`.
 *
 * Run: node scripts/verifyChartProjection.mjs   (or npm run verify:projection)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  MAX_BARS_AHEAD, IQR_Z, projectionMode, quantileBars, projectionState, projectionInputs,
  horizonChoices,
} from '../src/pages/StockMind/chartProjection.js';
import { interval as intervalDef, SESSION_MINUTES } from '../src/pages/StockMind/timeframes.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SM = path.join(ROOT, 'src', 'pages', 'StockMind');

let pass = 0;
let fail = 0;
const check = (label, ok, detail) => {
  if (ok) { pass += 1; console.log(`  PASS  ${label}`); }
  else { fail += 1; console.log(`  FAIL  ${label}${detail !== undefined ? ` - ${detail}` : ''}`); }
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const read = (f) => {
  try { return fs.readFileSync(f, 'utf8'); } catch { return ''; }
};
const near = (a, b, tol = 1e-9) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tol;

// ── Fixtures ──────────────────────────────────────────────────────────────────
//
// Built to mirror `ai_backend/engine/projection.py` exactly: for bar i the horizon sigma is
// `sigma·√i` and each band is `mid·exp(±b·s)`. Intraday stamps are UTC, because the store speaks UTC
// (Section 118) and this suite must give the same answer in any machine's zone.
const BASE = Math.floor(Date.parse('2026-09-18T03:45:00Z') / 1000);
const stampAt = (epoch) => new Date(epoch * 1000).toISOString().replace('T', ' ').slice(0, 19);

function makeCone({
  bars = 5, sigmaPct = 1.2, last = 100, daily = false, ok = true, capped = false,
  maxBarsAhead = MAX_BARS_AHEAD, tilted = false, bounds = true, quartiles = false,
  barInterval = '30m', drop = null,
} = {}) {
  const points = [];
  for (let i = 1; i <= bars; i += 1) {
    const s = (sigmaPct / 100) * Math.sqrt(i);
    const mid = last;
    const p = {
      time: daily
        ? new Date(Date.UTC(2026, 8, 17 + i)).toISOString().slice(0, 10)
        : stampAt(BASE + i * 1800),
      bar: i,
      mid,
      sigmaPct: s * 100,
    };
    if (bounds) {
      p.upper1 = mid * Math.exp(s);
      p.lower1 = mid * Math.exp(-s);
      p.upper2 = mid * Math.exp(2 * s);
      p.lower2 = mid * Math.exp(-2 * s);
    }
    if (quartiles) {
      // A future engine's own quartiles, deliberately NOT equal to the derived ones, so preferring
      // them is observable rather than a coincidence.
      p.q25 = mid * Math.exp(-0.5 * s);
      p.q75 = mid * Math.exp(0.5 * s);
    }
    if (drop) for (const k of drop) delete p[k];
    points.push(p);
  }
  return {
    ok, symbol: 'NIFTY50', interval: barInterval, barsAhead: bars, capped, maxBarsAhead,
    tilted, tiltReason: tilted ? 'centre tilted by the model\'s edge over even money' : 'centre flat',
    points,
    bands: [1, 2],
    volatility: {
      ok: true, symbol: 'NIFTY50', interval: barInterval, sigmaPct, sigmaAbs: last * sigmaPct / 100,
      atrPct: sigmaPct * 1.4, lastClose: last, asOf: '2026-09-18 10:00:00', rows: 480, lookback: 120,
    },
    anchor: { time: daily ? '2026-09-18' : stampAt(BASE), price: last },
    summary: { text: 'a sentence the engine composed' },
  };
}

const META_MISMATCH = {
  horizon: { name: 'swing', label: '~5 sessions', interval: '1d', bars: 5,
    measuredInterval: '30m', measuredBars: 5, fittedOnThisInterval: false },
  entitlement: {
    horizon: 'swing', entitled: false, reason: 'no model cleared the gate for this horizon',
    intervalMismatch: { asked: '30m', fittedOn: '1d', why: 'no model is fitted on 30m bars' },
  },
  caveat: 'the width is measured volatility',
};
const META_ENTITLED = {
  horizon: { name: 'swing', label: '~5 sessions', interval: '1d', bars: 5,
    measuredInterval: '1d', measuredBars: 5, fittedOnThisInterval: true },
  entitlement: { horizon: 'swing', entitled: true, reason: 'cleared the gate: gradient boosting',
    trainedAt: '2026-09-01', acceptedModels: ['gb'] },
  caveat: 'its centre is tilted by a model that cleared the gate',
};

console.log('\nchart projection — a distribution drawn as a bar, and never as a direction\n');

// ── 1-3. The body is the interquartile range, inside the wicks, never down ────
console.log('  1-3 the body IS the interquartile range, strictly inside the wicks, never a down bar');
const cone = makeCone({ bars: 8 });
const rows = quantileBars(cone, { chartType: 'candles', candleTime: BASE });
check('1. eight points become eight bars', rows.length === 8, String(rows.length));
check('1. open is mid·exp(−z·s) to 1e-9', rows.every((r, i) => {
  const p = cone.points[i];
  return near(r.open, p.mid * Math.exp(-IQR_Z * (p.sigmaPct / 100)));
}));
check('1. close is mid·exp(+z·s) to 1e-9', rows.every((r, i) => {
  const p = cone.points[i];
  return near(r.close, p.mid * Math.exp(IQR_Z * (p.sigmaPct / 100)));
}));
check('1. IQR_Z is the standard-normal upper quartile, not a rounded stand-in',
  near(IQR_Z, 0.6744897501960817, 1e-15), String(IQR_Z));

let insideAll = true;
let upAll = true;
for (const sigmaPct of [0.01, 0.1, 0.5, 1.2, 5, 12, 20]) {
  const c = makeCone({ bars: MAX_BARS_AHEAD, sigmaPct });
  const r = quantileBars(c, { chartType: 'candles', candleTime: BASE });
  if (r.length !== MAX_BARS_AHEAD) { insideAll = false; break; }
  for (const row of r) {
    if (!(row.low < row.open && row.open < row.close && row.close < row.high)) insideAll = false;
    if (!(row.open < row.close)) upAll = false;
  }
}
check('2. the body is strictly inside the wicks for sigma 0.01% to 20%, 1 to 40 bars ahead',
  insideAll);
check('3. open is below close for EVERY projected bar — a range has no direction', upAll);
check('3. and that holds for the engine-quartile branch too',
  quantileBars(makeCone({ bars: 12, quartiles: true }), { chartType: 'candles', candleTime: BASE })
    .every((r) => r.open < r.close && r.low < r.open && r.close < r.high));

// ── 4-7. Provenance: engine values verbatim, derived values marked ────────────
console.log('\n  4-7 the engine\'s own numbers are used verbatim, and derived ones say so');
check('4. high is point.upper2 verbatim', rows.every((r, i) => r.high === cone.points[i].upper2));
check('4. low is point.lower2 verbatim', rows.every((r, i) => r.low === cone.points[i].lower2));
const noBounds = makeCone({ bars: 4, bounds: false });
const noBoundRows = quantileBars(noBounds, { chartType: 'candles', candleTime: BASE });
check('5. with upper2/lower2 absent the ±2σ fallback is computed', noBoundRows.length === 4
  && noBoundRows.every((r, i) => {
    const p = noBounds.points[i];
    return near(r.high, p.mid * Math.exp(2 * (p.sigmaPct / 100)))
      && near(r.low, p.mid * Math.exp(-2 * (p.sigmaPct / 100)));
  }));
check('5. and the fallback is used ONLY then — a present bound is never recomputed',
  rows.every((r, i) => r.high === cone.points[i].upper2));
const withQ = makeCone({ bars: 4, quartiles: true });
const qRows = quantileBars(withQ, { chartType: 'candles', candleTime: BASE });
check('6. engine-sent q25/q75 are preferred over the derived pair',
  qRows.every((r, i) => r.open === withQ.points[i].q25 && r.close === withQ.points[i].q75));
check('6. and such a row is marked source "engine"', qRows.every((r) => r.source === 'engine'));
check('7. a derived row is marked source "derived" — the branches are distinguishable',
  rows.every((r) => r.source === 'derived'));
check('7. half a quartile pair is not a distribution, so it falls back to derived',
  quantileBars(makeCone({ bars: 3, quartiles: true, drop: ['q75'] }),
    { chartType: 'candles', candleTime: BASE }).every((r) => r.source === 'derived'));
check('7. a reversed quartile pair is refused and derived instead', (() => {
  const c = makeCone({ bars: 3, quartiles: true });
  for (const p of c.points) { const t = p.q25; p.q25 = p.q75; p.q75 = t; }
  return quantileBars(c, { chartType: 'candles', candleTime: BASE })
    .every((r) => r.source === 'derived');
})());

// ── 8-9. One chart holds one time type ───────────────────────────────────────
console.log('\n  8-9 one chart holds one time type, and a mismatch REFUSES rather than throws');
const dailyCone = makeCone({ bars: 5, daily: true, barInterval: '1d' });
check('8. a daily cone against an intraday chart returns [] rather than throwing',
  same(quantileBars(dailyCone, { chartType: 'candles', candleTime: BASE }), []));
check('8. and an intraday cone against a daily chart does the same',
  same(quantileBars(cone, { chartType: 'candles', candleTime: '2026-09-18' }), []));
check('9. a daily cone keeps YYYY-MM-DD times',
  quantileBars(dailyCone, { chartType: 'candles', candleTime: '2026-09-18' })
    .every((r) => typeof r.time === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.time)));
check('9. an intraday cone keeps epoch numbers', rows.every((r) => typeof r.time === 'number'));
check('9. and those epochs are the stored UTC instants, unshifted',
  rows[0].time === BASE + 1800, String(rows[0].time - BASE));
check('9. with no candles on the canvas yet the bars are still placed',
  quantileBars(cone, { chartType: 'candles' }).length === 8);

// ── 10-12. Per chart type ────────────────────────────────────────────────────
console.log('\n  10-12 what each chart type is allowed to draw, and what Heikin-Ashi is refused');
check('10. candles → quantile-candles', projectionMode('candles').mode === 'quantile-candles');
check('10. bars → quantile-bars', projectionMode('bars').mode === 'quantile-bars');
check('10. line, area and baseline → path',
  ['line', 'area', 'baseline'].every((t) => projectionMode(t).mode === 'path'));
check('10. heikin → refused', projectionMode('heikin').mode === 'refused');
check('10. and the refusal names the averaging as the reason',
  /average/i.test(projectionMode('heikin').reason));
check('10. every mode carries a reason that is a usable sentence',
  ['candles', 'bars', 'line', 'area', 'baseline', 'heikin', 'nonsense', '', null]
    .every((t) => typeof projectionMode(t).reason === 'string'
      && projectionMode(t).reason.length > 20));
check('11. quantileBars on heikin returns [] whatever the cone held',
  same(quantileBars(cone, { chartType: 'heikin', candleTime: BASE }), [])
  && same(quantileBars(makeCone({ bars: 40, quartiles: true }),
    { chartType: 'heikin', candleTime: BASE }), []));
check('12. line, area and baseline return [] — the band lines already say it',
  ['line', 'area', 'baseline']
    .every((t) => same(quantileBars(cone, { chartType: t, candleTime: BASE }), [])));
check('12. an unknown chart type draws nothing rather than guessing a shape',
  same(quantileBars(cone, { chartType: 'nope', candleTime: BASE }), []));

// ── 13-14. Junk, because this runs inside a render ───────────────────────────
console.log('\n  13-14 junk returns [] and never throws, and one bad point does not lose the rest');
const survives = (label, input, opts = { chartType: 'candles', candleTime: BASE }) => {
  let out;
  try { out = quantileBars(input, opts); } catch (err) { check(label, false, `threw ${err.message}`); return; }
  check(label, Array.isArray(out) && out.length === 0, JSON.stringify(out)?.slice(0, 80));
};
survives('13. ok:false', makeCone({ bars: 4, ok: false }));
survives('13. null', null);
survives('13. undefined', undefined);
survives('13. an empty object', {});
survives('13. an empty array', []);
survives('13. the string "nonsense"', 'nonsense');
survives('13. a number', 42);
survives('13. ok:true with no points', { ok: true, points: [] });
survives('13. ok:true with points that are not an array', { ok: true, points: 'lots' });
survives('13. points full of nulls', { ok: true, points: [null, null] });
check('13. junk opts falls back to the default type rather than throwing',
  [null, undefined, 'x', 42, []].every((o) => {
    let out;
    try { out = quantileBars(makeCone({ bars: 4 }), o); } catch { return false; }
    return Array.isArray(out) && out.length === 4;
  }));
const mixed = makeCone({ bars: 5 });
mixed.points[1].mid = NaN;
mixed.points[2].sigmaPct = null;
mixed.points[3].sigmaPct = -2;
const mixedRows = quantileBars(mixed, { chartType: 'candles', candleTime: BASE });
check('14. a NaN mid, a null sigma and a negative sigma are skipped, the rest survive',
  mixedRows.length === 2, String(mixedRows.length));
check('14. and the survivors are the first and last points',
  mixedRows[0].bar === 1 && mixedRows[1].bar === 5);
check('14. a zero sigma is skipped — a zero-width body is not a drawable bar', (() => {
  const c = makeCone({ bars: 2 });
  c.points[0].sigmaPct = 0;
  return quantileBars(c, { chartType: 'candles', candleTime: BASE }).length === 1;
})());
check('14. an unusable time is skipped rather than passed to the library', (() => {
  const c = makeCone({ bars: 3 });
  c.points[1].time = 'not a date';
  return quantileBars(c, { chartType: 'candles', candleTime: BASE }).length === 2;
})());
check('14. a body outside its own wicks is refused even when the engine sent it', (() => {
  const c = makeCone({ bars: 2, quartiles: true });
  c.points[0].q75 = c.points[0].upper2 * 2;        // body wider than the wick
  return quantileBars(c, { chartType: 'candles', candleTime: BASE }).length === 1;
})());
check('14. quantileBars does not mutate the cone it was given', (() => {
  const c = makeCone({ bars: 4 });
  const snapshot = JSON.stringify(c);
  quantileBars(c, { chartType: 'candles', candleTime: BASE });
  return JSON.stringify(c) === snapshot;
})());

// ── 15-20. The projection's own state ────────────────────────────────────────
console.log('\n  15-20 the state is a CLASS and a cap, never a confidence');
const cappedCone = makeCone({ bars: MAX_BARS_AHEAD, capped: true });
const cappedState = projectionState(cappedCone,
  { ...META_MISMATCH, horizon: { ...META_MISMATCH.horizon, measuredBars: 60 } },
  { chartType: 'candles', interval: '30m' });
check('15. capped is true exactly when the cone says so', cappedState.capped === true
  && projectionState(cone, null, { chartType: 'candles', interval: '30m' }).capped === false);
check('15. requestedBars carries the number master asked for', cappedState.requestedBars === 60,
  String(cappedState.requestedBars));
check('15. and an explicit cone.requestedBars outranks the horizon\'s figure',
  projectionState({ ...cappedCone, requestedBars: 90 }, META_MISMATCH,
    { chartType: 'candles', interval: '30m' }).requestedBars === 90);
check('16. maxBarsAhead falls back to MAX_BARS_AHEAD when the cone omits it', (() => {
  const c = makeCone({ bars: 5 });
  delete c.maxBarsAhead;
  return projectionState(c, null, { chartType: 'candles', interval: '30m' })
    .maxBarsAhead === MAX_BARS_AHEAD;
})());
check('16. and the cone\'s own figure is honoured when it sends one',
  projectionState(makeCone({ bars: 5, maxBarsAhead: 25 }), null,
    { chartType: 'candles', interval: '30m' }).maxBarsAhead === 25);

// THE DRIFT TEST. The Python cannot be imported on this machine (no numpy), so the constant is read
// out of its source — the precedent `verifyTimeframes.mjs` set against `providers.py`.
const py = read(path.join(ROOT, 'ai_backend', 'engine', 'projection.py'));
const pyMax = (py.match(/^MAX_BARS_AHEAD\s*=\s*(\d+)/m) || [])[1];
check('17. the engine declares MAX_BARS_AHEAD in a form this test can read', !!pyMax, pyMax);
check('17. and the JS constant agrees with it', Number(pyMax) === MAX_BARS_AHEAD,
  `python ${pyMax} vs js ${MAX_BARS_AHEAD}`);

const flatState = projectionState(cone, META_MISMATCH, { chartType: 'candles', interval: '30m' });
const tiltedState = projectionState(makeCone({ bars: 5, tilted: true }), META_ENTITLED,
  { chartType: 'candles', interval: '1d' });
check('18. the class is "reflex" whether the centre is tilted or flat',
  flatState.classLabel === 'reflex' && tiltedState.classLabel === 'reflex');
check('18. the citation is reflex:projection',
  flatState.cite === 'reflex:projection' && tiltedState.cite === 'reflex:projection');
check('18. modal is true only when the centre was tilted',
  flatState.modal === false && tiltedState.modal === true);
const stateKeys = [...Object.keys(flatState), ...Object.keys(tiltedState), ...Object.keys(cappedState)];
check('19. no state key is a confidence — the badge prints a class, never a percentage',
  !stateKeys.some((k) => /confidence/i.test(k)), stateKeys.join(','));
check('19. and no composed sentence quotes a probability as a percentage of belief',
  !/confidence/i.test(flatState.text + tiltedState.text + flatState.entitlementReason));
check('20. an unentitled interval mismatch names BOTH intervals',
  flatState.entitled === false && /\b30m\b/.test(flatState.entitlementReason)
  && /\b1d\b/.test(flatState.entitlementReason), flatState.entitlementReason);
check('20. an entitled horizon says so with the gate\'s own reason',
  tiltedState.entitled === true && /cleared the gate/.test(tiltedState.entitlementReason));
check('20. the measured interval is compared with the chart\'s, and the mismatch is flagged',
  flatState.measuredInterval === '30m' && flatState.chartInterval === '30m'
  && flatState.intervalMatches === true
  && projectionState(cone, META_ENTITLED, { chartType: 'candles', interval: '30m' })
    .intervalMatches === false);
check('20. measuredBars and barsAhead are both carried',
  flatState.measuredBars === 5 && flatState.barsAhead === 8);
check('20. the mode and its reason travel with the state',
  flatState.mode === 'quantile-candles'
  && projectionState(cone, null, { chartType: 'heikin', interval: '30m' }).mode === 'refused'
  && /average/i.test(projectionState(cone, null, { chartType: 'heikin', interval: '30m' })
    .modeReason));
check('20. text is a non-empty sentence for every input, including junk', [
  [cone, META_MISMATCH], [cone, null], [null, null], [{}, {}], ['x', 'y'], [[], []],
].every(([c, m]) => {
  const s = projectionState(c, m, { chartType: 'candles', interval: '30m' });
  return typeof s.text === 'string' && s.text.length > 10 && /\.$/.test(s.text);
}));

// ── 21-22. The input ledger ──────────────────────────────────────────────────
console.log('\n  21-22 absent reads as absent, and nothing reads as "neutral"');
const ledger = projectionInputs(cone, META_MISMATCH);
const byId = Object.fromEntries(ledger.map((r) => [r.id, r]));
check('21. price and volatility are used, and say what they were measured from',
  byId.price?.used === true && byId.volatility?.used === true
  && /480/.test(byId.price.text) && /120/.test(byId.volatility.text));
check('21. news, macro and derivatives are used:false and read "absent"',
  ['news', 'macro', 'derivatives'].every((k) => byId[k]?.used === false
    && /absent/i.test(byId[k].text) && /not an input to this projection/i.test(byId[k].text)));
check('21. the model row is used only when the centre was tilted',
  byId.model?.used === false
  && projectionInputs(makeCone({ bars: 5, tilted: true }), META_ENTITLED)
    .find((r) => r.id === 'model').used === true);
check('22. no row anywhere is worded "neutral"', [
  ...ledger, ...projectionInputs(makeCone({ bars: 5, tilted: true }), META_ENTITLED),
  ...projectionInputs(null, null), ...projectionInputs({}, {}),
].every((r) => !/neutral/i.test(r.text) && !/neutral/i.test(r.label)));
check('22. every row has an id, a label, a boolean used and a sentence',
  ledger.every((r) => r.id && r.label && typeof r.used === 'boolean'
    && typeof r.text === 'string' && /[.]$/.test(r.text)));
check('22. junk still produces a renderable ledger rather than throwing',
  [null, undefined, {}, [], 'x', 42].every((c) => Array.isArray(projectionInputs(c, null))
    && projectionInputs(c, null).length > 0));
check('22. a future engine\'s own inputs ledger is preferred verbatim', (() => {
  const c = makeCone({ bars: 4 });
  c.inputs = [{ id: 'price', label: 'price', used: true, text: 'the engine said this itself.' }];
  const out = projectionInputs(c, null);
  return out.length === 1 && out[0].text === 'the engine said this itself.';
})());
check('22. an absent volatility reading says so rather than claiming a width', (() => {
  const c = makeCone({ bars: 4 });
  c.volatility = { ok: false, reason: 'not enough bars' };
  const out = projectionInputs(c, null);
  return out.find((r) => r.id === 'volatility').used === false
    && /absent/i.test(out.find((r) => r.id === 'volatility').text);
})());

// ── 23-25. The horizon presets ───────────────────────────────────────────────
console.log('\n  23-25 the horizons on offer, bounded by the engine\'s ceiling');
const h30 = horizonChoices('30m');
check('23. 30m offers four presets', h30.length === 4, String(h30.length));
check('23. none of them exceeds the engine\'s ceiling',
  h30.every((h) => h.bars > 0 && h.bars <= MAX_BARS_AHEAD));
check('23. the last one IS the ceiling and is marked atCap',
  h30[h30.length - 1].bars === MAX_BARS_AHEAD && h30[h30.length - 1].atCap === true);
check('23. and only the last one is', h30.filter((h) => h.atCap).length === 1);
check('23. the cap\'s title says the engine will not project further',
  /ceiling/i.test(h30[h30.length - 1].title));
check('23. the presets ascend', h30.every((h, i) => i === 0 || h30[i - 1].bars < h.bars));
check('24. an intraday preset is labelled in minutes or hours',
  h30.every((h) => /minutes|hours/.test(h.span)),
  h30.map((h) => h.span).join(','));
check('24. 5 bars of 30m reads as 2.5 hours', h30[0].span === '2.5 hours', h30[0].span);
check('24. 5 bars of 1m reads in minutes', horizonChoices('1m')[0].span === '5 minutes',
  horizonChoices('1m')[0].span);
const h1d = horizonChoices('1d');
check('24. daily and coarser are labelled in trading SESSIONS, not calendar days',
  h1d.every((h) => /session/.test(h.span)), h1d.map((h) => h.span).join(','));
check('24. 5 daily bars are 5 sessions', h1d[0].span === '5 trading sessions', h1d[0].span);
check('24. 5 weekly bars are 25 sessions, because a week is five sessions',
  horizonChoices('1wk')[0].span === '25 trading sessions', horizonChoices('1wk')[0].span);
check('24. the session figure comes from timeframes.js rather than a second table',
  intervalDef('1d').span === SESSION_MINUTES);
check('24. every preset carries a label naming its bar count',
  h30.every((h) => h.label === `${h.bars} bars`));
check('25. an unknown interval offers nothing rather than guessing',
  same(horizonChoices('nonsense'), []) && same(horizonChoices(''), [])
  && same(horizonChoices(null), []) && same(horizonChoices(undefined), [])
  && same(horizonChoices(42), []) && same(horizonChoices({}), []));

// ── 26-35. Source level: what cannot be reached without a screen ─────────────
console.log('\n  26-35 source-level — the pixels, the plumbing and the two suites being protected');
const chart = read(path.join(SM, 'PriceChart.jsx'));
const mod = read(path.join(SM, 'chartProjection.js'));
const page = read(path.join(SM, 'StockMind.jsx'));
const pkg = read(path.join(ROOT, 'package.json'));

// The projected-series block, sliced out so the real price series' green and red are not read as
// this feature's. Both ends are lines this feature owns.
const blockFrom = chart.indexOf('const projRows = quantileBars(');
const blockTo = chart.indexOf('projBarsRef.current = projSeries;');
const projBlock = (blockFrom > 0 && blockTo > blockFrom) ? chart.slice(blockFrom, blockTo) : '';

check('26. the projected series is created with the cone\'s own bandColor',
  projBlock.length > 100 && /bandColor/.test(projBlock), String(projBlock.length));
check('26. and NEVER with theme.green or theme.red — a range has no direction',
  projBlock.length > 100 && !/theme\.(green|red)/.test(projBlock));
check('27. upColor and downColor of the projected candles are the same expression',
  /upColor: `\$\{bandColor\}1f`, downColor: `\$\{bandColor\}1f`/.test(projBlock));
check('27. and of the projected bars too',
  /upColor: `\$\{bandColor\}aa`, downColor: `\$\{bandColor\}aa`/.test(projBlock));
// Hue and thinness are the only two things separating a projected bar from a traded one in this
// chart type, so both are pinned rather than one.
check('27. the projected bars stay thin, so a real bar outranks them',
  /thinBars: true/.test(projBlock));
check('27. the candle body is near-hollow with a visible border, so a real candle outranks it',
  /borderVisible: true/.test(projBlock) && /borderUpColor: `\$\{bandColor\}cc`/.test(projBlock));
check('28. the projected series is excluded from the price axis and the price line',
  /lastValueVisible: false, priceLineVisible: false/.test(projBlock));
// Sliced to the marker call itself: the word "projected" also appears in a comment in the block
// above, so reading projBlock would leave the visible label unasserted.
const markFrom = projBlock.indexOf('createSeriesMarkers(projSeries,');
const markBlock = markFrom >= 0 ? projBlock.slice(markFrom) : '';
check('28. and the first projected bar carries a marker whose LABEL says so',
  /createSeriesMarkers\(projSeries,/.test(chart) && /text: 'projected/.test(markBlock),
  String(markBlock.length));
check('28. that marker sits above the bar, and there is exactly one of them',
  /position: 'aboveBar'/.test(markBlock)
  && (markBlock.match(/time:/g) || []).length === 1,
  String((markBlock.match(/time:/g) || []).length));
check('29. attachPrimitive still appears EXACTLY twice — no third series primitive',
  (chart.match(/attachPrimitive\(/g) || []).length === 2,
  String((chart.match(/attachPrimitive\(/g) || []).length));
check('30. timeScale().fitContent() still appears exactly once',
  (chart.match(/timeScale\(\)\.fitContent\(\)/g) || []).length === 1,
  String((chart.match(/timeScale\(\)\.fitContent\(\)/g) || []).length));
check('31. the chart imports the decision module',
  /from '\.\/chartProjection\.js'/.test(chart));
check('31. and holds no copy of the quartile constant or the engine\'s ceiling',
  !/IQR_Z\s*=/.test(chart) && !/MAX_BARS_AHEAD\s*=/.test(chart));
check('31. the module imports the tested time rule rather than redefining it',
  /from '\.\/chartTime\.js'/.test(mod) && !/function toChartTime/.test(mod)
  && !/getTimezoneOffset/.test(mod));
check('31. and takes its bar spans from timeframes.js rather than a second table',
  /from '\.\/timeframes\.js'/.test(mod) && !/SESSION_MINUTES\s*=\s*\d/.test(mod));
check('31. the module touches no charting library, so it stays testable without one',
  !/lightweight-charts/.test(mod));
check('32. the Heikin-Ashi refusal is RENDERED, not only commented',
  /projState\.mode === 'refused'/.test(chart) && /\{projState\.modeReason\}/.test(chart));
check('32. the state strip prints the class and the mode',
  /\{projState\.cite\}/.test(chart) && /\{projState\.mode\}/.test(chart));
check('33. cone.capped is read in the JSX', /\{cone\.capped &&/.test(chart));
check('33. cone.maxBarsAhead is read in the JSX', /cone\.maxBarsAhead \|\|/.test(chart));
check('33. and the clamp sentence names what was asked for',
  /You asked for \$\{projState\.requestedBars\} bars ahead/.test(chart));
check('34. exactly one InfoTip names projectedCandle',
  (chart.match(/id="projectedCandle"/g) || []).length === 1);
check('34. exactly one names projectionHorizon',
  (chart.match(/id="projectionHorizon"/g) || []).length === 1);
check('34. and exactly one names claimClass',
  (chart.match(/id="claimClass"/g) || []).length === 1);
check('35. no console.log in either file',
  !/console\.log/.test(chart) && !/console\.log/.test(mod) && !/console\.log/.test(page));
check('35. no TODO or FIXME marker',
  !/(?:\/\/|\/\*)\s*(?:TODO|FIXME)\b/i.test(chart + mod + page));
check('35. lightweight-charts is still pinned at 5.2.1 and nothing is range-pinned',
  /"lightweight-charts": "5\.2\.1"/.test(pkg) && !/[\^~]\d/.test(pkg));
check('35. package.json has a verify:projection script',
  /"verify:projection": "node scripts\/verifyChartProjection\.mjs"/.test(pkg));
check('35. and the verify chain runs it after the empty-state suite, appended not reordered',
  /verifyChartEmptyState\.mjs && node scripts\/verifyChartProjection\.mjs/.test(pkg));

// ── The plumbing the state strip cannot work without ─────────────────────────
console.log('\n  the siblings the page used to discard, and the three call sites');
check('every new prop is optional with a null default, so the existing call sites keep working',
  /horizonBars = null/.test(chart) && /onHorizonBars = null/.test(chart)
  && /projectionMeta = null/.test(chart));
check('the page keeps the forecast reply\'s entitlement, horizon and caveat',
  /entitlement: res\.data\?\.entitlement \|\| null/.test(page)
  && /horizon: res\.data\?\.horizon \|\| null/.test(page)
  && /caveat: res\.data\?\.caveat \|\| null/.test(page));
check('and clears them on a failure rather than describing a moment that has passed',
  /setConeMeta\(null\)/.test(page));
check('the horizon travels to the engine as a bar count',
  /bars: horizonBars \|\| null/.test(page));
check('changing the horizon refetches the cone',
  /\[coneOn, sym, barInterval, horizonBars\]/.test(page));
check('both of the page\'s PriceChart call sites are passed the new props',
  (page.match(/projectionMeta=/g) || []).length === 2
  && (page.match(/onHorizonBars=/g) || []).length === 2,
  String((page.match(/projectionMeta=/g) || []).length));
check('the PROJECTION panel no longer reads cone.horizon, a key that never existed',
  !/cone\.horizon/.test(page) && /coneMeta\?\.horizon\?\.label/.test(page));
check('and that panel shows the cap beside the bars-ahead count',
  /cone\.maxBarsAhead \|\| '—'/.test(page));
check('PopoutPanel is untouched by the projection half — it has no cone',
  !/projectionMeta/.test(read(path.join(SM, 'PopoutPanel.jsx'))));

console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
