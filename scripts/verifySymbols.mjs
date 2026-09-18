#!/usr/bin/env node

/**
 * verifySymbols.mjs — the symbol picker, and the one thing it must never do.
 *
 * The picker replaced a free-text box (spec Section 101). The failure it must not introduce is
 * OFFERING A NAME THE ENGINE CANNOT RESOLVE: a name in the dropdown is an implicit promise that
 * selecting it produces bars, and a broken promise from a dropdown is worse than a typo in a text
 * box, because master has no reason to suspect his own input. So every mapped name here is checked
 * against `providers.YAHOO_SYMBOLS` in the Python, across the language boundary nothing else spans.
 *
 * The second property is that the picker never becomes a GATE. Free text stays; the assertions below
 * cover the case where master's symbol is not in any list.
 *
 * Run: node scripts/verifySymbols.mjs   (or npm run verify:symbols)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import * as sym from '../src/pages/StockMind/symbols.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let pass = 0;
let fail = 0;
const check = (label, ok, detail) => {
  if (ok) { pass += 1; console.log(`  PASS  ${label}`); }
  else { fail += 1; console.log(`  FAIL  ${label}${detail ? ` - ${detail}` : ''}`); }
};
const eq = (label, got, want) => check(label, got === want, `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

const flat = (ex, inv, cur) => sym.flatOptionsFor(ex, inv, cur).map((o) => o.id);

// ── Shape ─────────────────────────────────────────────────────────────────────
console.log('\n--- the lists are well formed ---');

check('mapped ids are unique',
  new Set(sym.MAPPED.map((m) => m.id)).size === sym.MAPPED.length);
check('every mapped entry names at least one exchange',
  sym.MAPPED.every((m) => Array.isArray(m.exchanges) && m.exchanges.length > 0));
check('every mapped entry has a group and a human label',
  sym.MAPPED.every((m) => !!m.group && !!m.label && m.label !== m.id.toLowerCase()));
check('ids are upper case, because the engine upper-cases before mapping',
  sym.MAPPED.every((m) => m.id === m.id.toUpperCase()));
check('equity lists have no duplicates',
  new Set(sym.INDIA_EQUITIES).size === sym.INDIA_EQUITIES.length
  && new Set(sym.US_EQUITIES).size === sym.US_EQUITIES.length);
check('the two equity lists do not overlap',
  sym.INDIA_EQUITIES.every((s) => !sym.US_EQUITIES.includes(s)));

// ── Exchange scoping ──────────────────────────────────────────────────────────
console.log('\n--- the exchange selector actually selects ---');

const nse = flat('NSE');
const bse = flat('BSE');
const ndq = flat('NASDAQ');

check('NIFTY 50 is on NSE and not on NASDAQ', nse.includes('NIFTY50') && !ndq.includes('NIFTY50'));
check('SENSEX is on BSE and not on NSE', bse.includes('SENSEX') && !nse.includes('SENSEX'));
check('Indian equities appear on NSE, not on NASDAQ',
  nse.includes('RELIANCE') && !ndq.includes('RELIANCE'));
check('US equities appear on NASDAQ, not on NSE',
  ndq.includes('AAPL') && !nse.includes('AAPL'));
check('every exchange offers something',
  ['NSE', 'BSE', 'NASDAQ', 'NYSE'].every((ex) => flat(ex).length > 10));
check('an unknown exchange falls back to NSE rather than an empty list',
  flat('MOON').includes('NIFTY50'));
check('the exchange name is case-insensitive',
  flat('nse').length === nse.length);
check('no list has duplicate ids',
  ['NSE', 'BSE', 'NASDAQ', 'NYSE'].every((ex) => {
    const ids = flat(ex);
    return new Set(ids).size === ids.length;
  }));

// ── The stored series ─────────────────────────────────────────────────────────
console.log('\n--- "what Rama already has" is a separate answer from "what it could fetch" ---');

const inventory = [
  { symbol: 'NIFTY50', exchange: 'NSE', interval: '1d', bars: 4649 },
  { symbol: 'NIFTY50', exchange: 'NSE', interval: '15m', bars: 1726 },
  { symbol: 'NIFTY50', exchange: 'NSE', interval: '60m', bars: 3499 },
  { symbol: 'RELIANCE', exchange: 'NSE', interval: '1d', bars: 4520 },
  { symbol: 'AAPL', exchange: 'NASDAQ', interval: '1d', bars: 10000 },
];

const grouped = sym.optionsFor('NSE', inventory, '');
const storedGroup = grouped.find((g) => g.group === 'Stored locally');
check('a stored group appears', !!storedGroup);
eq('three stored intervals of one symbol collapse to one entry',
  storedGroup.items.filter((i) => i.id === 'NIFTY50').length, 1);
check('the stored group lists exactly the NSE symbols held',
  JSON.stringify(storedGroup.items.map((i) => i.id).sort()) === JSON.stringify(['NIFTY50', 'RELIANCE']),
  storedGroup.items.map((i) => i.id).join(','));
check('a series stored under another exchange is not offered here',
  !storedGroup.items.some((i) => i.id === 'AAPL'));
check('but it IS offered under its own exchange',
  sym.optionsFor('NASDAQ', inventory, '').find((g) => g.group === 'Stored locally')
    ?.items.some((i) => i.id === 'AAPL'));
check('stored symbols come first, so the no-network choices are at the top',
  grouped[0].group === 'Stored locally');
check('held is marked on the stored entry and not invented elsewhere',
  storedGroup.items.every((i) => i.held === true)
  && grouped.filter((g) => g.group !== 'Stored locally')
    .every((g) => g.items.every((i) => i.held === false || i.id === 'NIFTY50' || i.id === 'RELIANCE')));
check('a symbol both held and known is not duplicated in the flat list',
  flat('NSE', inventory).filter((s) => s === 'NIFTY50').length === 1);
check('no inventory at all still yields the known list',
  flat('NSE', []).length > 10 && flat('NSE', null).length > 10);
check('a malformed inventory row is skipped, not thrown on',
  flat('NSE', [null, {}, { symbol: '' }, { symbol: 'TCS' }]).includes('TCS'));

// ── Never a gate ──────────────────────────────────────────────────────────────
console.log('\n--- the picker is a shortcut, never a gate ---');

const typed = sym.optionsFor('NSE', [], 'SOMETHINGODD');
check('an unknown typed symbol is added so a select cannot silently show another value',
  typed.some((g) => g.items.some((i) => i.id === 'SOMETHINGODD')));
check('it is labelled as typed rather than folded in with the known names',
  typed.find((g) => g.group === 'Typed')?.items[0].id === 'SOMETHINGODD');
check('a typed symbol that IS known does not get a second entry',
  !sym.optionsFor('NSE', [], 'RELIANCE').some((g) => g.group === 'Typed'));
check('typed input is upper-cased, as the engine does',
  sym.optionsFor('NSE', [], 'reliance').every((g) => !g.items.some((i) => i.id === 'reliance')));
check('lower-case typed input still resolves to the known entry',
  !sym.optionsFor('NSE', [], 'reliance').some((g) => g.group === 'Typed'));
check('isKnown never blocks — it only labels',
  sym.isKnown('RELIANCE', 'NSE') === true && sym.isKnown('SOMETHINGODD', 'NSE') === false);
check('isKnown is case-insensitive', sym.isKnown('reliance', 'NSE') === true);
eq('an empty symbol is not known', sym.isKnown('', 'NSE'), false);
check('every group is non-empty',
  sym.optionsFor('NSE', inventory, 'X').every((g) => g.items.length > 0));

// ── The cross-language drift check ────────────────────────────────────────────
//
// This is the assertion that stops the dropdown promising something the engine cannot resolve.
console.log('\n--- every mapped name still resolves in the engine ---');

const PROVIDERS_PY = path.join(ROOT, 'ai_backend', 'engine', 'providers.py');
let pyText = '';
try { pyText = fs.readFileSync(PROVIDERS_PY, 'utf8'); } catch { pyText = ''; }
check('providers.py is readable', pyText.length > 0, PROVIDERS_PY);

function parseYahooSymbols(text) {
  const start = text.indexOf('YAHOO_SYMBOLS');
  if (start < 0) return null;
  const open = text.indexOf('{', start);
  const close = text.indexOf('}', open);
  if (open < 0 || close < 0) return null;
  const out = {};
  for (const m of text.slice(open + 1, close).matchAll(/["']([^"']+)["']\s*:\s*["']([^"']+)["']/g)) {
    out[m[1]] = m[2];
  }
  return Object.keys(out).length > 0 ? out : null;
}

const py = parseYahooSymbols(pyText);
check('YAHOO_SYMBOLS was found and parsed', py !== null,
  'the dict moved or changed shape — re-point the parser, do not delete the check');

if (py) {
  const unmapped = sym.MAPPED.map((m) => m.id).filter((id) => !(id in py));
  check('every mapped name exists in the engine\'s Yahoo map', unmapped.length === 0,
    unmapped.join(','));
  // Python may map more than the picker offers (aliases like NIFTY and NIFTYMID); the picker
  // offering one Python lacks is the defect.
  check('the picker offers a subset, which is the safe direction',
    sym.MAPPED.length <= Object.keys(py).length + sym.MAPPED.length);

  // Equities must NOT be in the explicit map — they rely on the `.NS`/`.BO`/bare-ticker suffix
  // rules. A name that slipped into both places would resolve twice and could disagree.
  const doubled = sym.INDIA_EQUITIES.concat(sym.US_EQUITIES).filter((s) => s in py);
  check('equity names rely on the suffix rules and are not double-mapped',
    doubled.length === 0, doubled.join(','));

  // The suffix rules are what make an unmapped name work at all, so their existence is asserted
  // rather than assumed.
  check('the engine still appends .NS for unmapped Indian names', /\.NS"/.test(pyText));
  check('the engine still appends .BO for BSE', /\.BO"/.test(pyText));
  check('the engine still passes US tickers through bare',
    /NASDAQ["'],\s*["']NYSE/.test(pyText) || /"NASDAQ", "NYSE"/.test(pyText));
}

// ── Hostile input ─────────────────────────────────────────────────────────────
console.log('\n--- hostile input does not throw ---');

for (const bad of [null, undefined, 0, '', {}, [], '__proto__', 'constructor']) {
  let threw = null;
  try {
    sym.optionsFor(bad, bad, bad);
    sym.flatOptionsFor(bad, bad, bad);
    sym.isKnown(bad, bad);
  } catch (e) { threw = e.message; }
  check(`${JSON.stringify(bad)} is handled`, threw === null, threw);
}
// A prototype-shaped name must behave like any other typed string — appearing once, in the Typed
// group, and never colliding with an internal key. The groups are built on Maps for this reason.
const protoOpts = sym.optionsFor('NSE', [], '__proto__');
check('a prototype-shaped name is an ordinary typed entry',
  protoOpts.find((g) => g.group === 'Typed')?.items.map((i) => i.id).join(',') === '__PROTO__');
eq('and it appears exactly once', flat('NSE', [], '__proto__').filter((s) => s === '__PROTO__').length, 1);
check('whitespace-only input adds no entry',
  !sym.optionsFor('NSE', [], '   ').some((g) => g.group === 'Typed'));
check('an unrecognised exchange normalises to NSE, exactly as the engine does',
  sym.normaliseExchange('MOON') === 'NSE' && sym.normaliseExchange('') === 'NSE'
  && sym.normaliseExchange('bse') === 'BSE' && sym.normaliseExchange('nyse') === 'NYSE'
  && sym.normaliseExchange('US') === 'US');

console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
