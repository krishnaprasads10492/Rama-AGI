#!/usr/bin/env node

/**
 * verifyGlossary.mjs — the help text, and the drift that would make it worse than nothing.
 *
 * WHY THIS IS TESTED (spec Section 104). Help text has a specific failure mode: it rots silently. A
 * `?` that opens onto nothing, a definition for a field that was renamed two months ago, a screen map
 * whose callout points at a term that no longer exists — none of those break a build, none show up in
 * a diff, and every one of them costs more trust than having no help at all, because master has been
 * invited to rely on it.
 *
 * So the assertions here are mostly about REFERENTIAL INTEGRITY across files:
 *   - every `InfoTip id=` in the renderer names a term that exists
 *   - every `seeAlso` points at a real term
 *   - every screen-map callout points at a real term
 *   - every term is reachable — defined and never referenced from anywhere is dead weight
 *
 * Plus the qualities that make a definition useful rather than circular: a short line that fits a
 * popover, a long one that says more than the short one, and no entry that defines a term using only
 * itself.
 *
 * Run: node scripts/verifyGlossary.mjs   (or npm run verify:glossary)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import * as G from '../src/pages/StockMind/glossary.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SM = path.join(ROOT, 'src', 'pages', 'StockMind');

let pass = 0;
let fail = 0;
const check = (label, ok, detail) => {
  if (ok) { pass += 1; console.log(`  PASS  ${label}`); }
  else { fail += 1; console.log(`  FAIL  ${label}${detail ? ` - ${detail}` : ''}`); }
};
const eq = (label, got, want) => check(label, got === want, `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

const ids = G.termIds();
const read = (f) => {
  try { return fs.readFileSync(path.join(SM, f), 'utf8'); } catch { return ''; }
};

// ── Shape ─────────────────────────────────────────────────────────────────────
console.log('\n--- every entry is well formed ---');

check('there are terms at all', ids.length > 50, String(ids.length));
check('every term has a display name, a group, a short and a long',
  ids.every((id) => {
    const t = G.TERMS[id];
    return t && typeof t.term === 'string' && t.term.length > 0
      && typeof t.group === 'string' && typeof t.short === 'string' && typeof t.long === 'string';
  }),
  ids.filter((id) => {
    const t = G.TERMS[id];
    return !(t && t.term && t.group && t.short && t.long);
  }).join(','));

const groupIds = new Set(G.GROUPS.map((g) => g.id));
check('every term belongs to a declared group',
  ids.every((id) => groupIds.has(G.TERMS[id].group)),
  ids.filter((id) => !groupIds.has(G.TERMS[id].group)).map((id) => `${id}:${G.TERMS[id].group}`).join(','));
check('every group has at least one term',
  G.GROUPS.every((g) => G.termsInGroup(g.id).length > 0),
  G.GROUPS.filter((g) => G.termsInGroup(g.id).length === 0).map((g) => g.id).join(','));
check('group ids are unique', new Set(G.GROUPS.map((g) => g.id)).size === G.GROUPS.length);

// A `short` that does not fit a popover defeats the popover; a `long` shorter than the `short` means
// the expanded view tells master less than the tooltip did.
const longShorts = ids.filter((id) => G.TERMS[id].short.length > 130);
check('every short line fits a popover', longShorts.length === 0,
  longShorts.map((id) => `${id}:${G.TERMS[id].short.length}`).join(', '));
const tooBrief = ids.filter((id) => G.TERMS[id].long.length <= G.TERMS[id].short.length);
check('every long definition says more than its own short one', tooBrief.length === 0,
  tooBrief.join(','));
const tooLong = ids.filter((id) => G.TERMS[id].long.length > 700);
check('no long definition runs past a readable paragraph', tooLong.length === 0,
  tooLong.map((id) => `${id}:${G.TERMS[id].long.length}`).join(', '));
check('every short line ends in a full stop, so a popover reads as a sentence',
  ids.every((id) => /[.!?]$/.test(G.TERMS[id].short.trim())),
  ids.filter((id) => !/[.!?]$/.test(G.TERMS[id].short.trim())).join(','));

// A definition whose only content is its own name is a dictionary loop. Checked by requiring the long
// text to contain at least a few words that are not in the term itself.
// Eight substantive words beyond the term's own name. The point is to catch "Max drawdown: the maximum
// drawdown" — a definition that restates the label — not to demand length from entries that are simply
// concise.
const circular = ids.filter((id) => {
  const words = new Set(G.TERMS[id].term.toLowerCase().split(/\W+/).filter(Boolean));
  const body = G.TERMS[id].long.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
  return body.filter((w) => !words.has(w)).length < 8;
});
check('no definition is circular or near-empty', circular.length === 0, circular.join(','));

check('display names are unique — two entries with one name is a coin toss for the reader',
  new Set(ids.map((id) => G.TERMS[id].term)).size === ids.length,
  ids.map((id) => G.TERMS[id].term)
    .filter((t, i, a) => a.indexOf(t) !== i).join(', '));

// ── Referential integrity ─────────────────────────────────────────────────────
console.log('\n--- every reference points at something that exists ---');

const missingSeeAlso = [];
for (const id of ids) {
  for (const s of G.TERMS[id].seeAlso || []) {
    if (!G.TERMS[s]) missingSeeAlso.push(`${id} -> ${s}`);
  }
}
check('every "see also" resolves', missingSeeAlso.length === 0, missingSeeAlso.join(', '));
const selfRef = ids.filter((id) => (G.TERMS[id].seeAlso || []).includes(id));
check('nothing points at itself', selfRef.length === 0, selfRef.join(','));

// Every `InfoTip id="..."` across the StockMind pages.
const FILES = fs.existsSync(SM)
  ? fs.readdirSync(SM).filter((f) => f.endsWith('.jsx') || f.endsWith('.js'))
  : [];
check('the StockMind directory was found', FILES.length > 5, String(FILES.length));

const used = new Set();
const badUses = [];
for (const f of FILES) {
  const text = read(f);
  for (const m of text.matchAll(/<InfoTip\s+id=["']([A-Za-z0-9_]+)["']/g)) {
    used.add(m[1]);
    if (!G.TERMS[m[1]]) badUses.push(`${f}: ${m[1]}`);
  }
  // `info="term"` on the Stat component is the other reference form.
  for (const m of text.matchAll(/\binfo=["']([A-Za-z0-9_]+)["']/g)) {
    used.add(m[1]);
    if (!G.TERMS[m[1]]) badUses.push(`${f}: info=${m[1]}`);
  }
}
check('every InfoTip and info= names a term that exists', badUses.length === 0, badUses.join(', '));
check('the components actually reference terms', used.size > 20, String(used.size));

// Screen-map callouts are IMPORTED, not scraped. The earlier regex version could not tell a pin's term
// id from a column heading inside the SVG, so it reported `GRADE` and `TCS` as broken references while
// missing real ones — which is why the callout data now lives in a plain module.
const mapText = read('ScreenMap.jsx');
const helpText = read('HelpPanel.jsx');
const { SCREEN_DATA, SCREEN_ORDER, citedTermIds } =
  await import('../src/pages/StockMind/screenMapData.js');

const citedInMaps = new Set(citedTermIds());
// The help screen's own links are still text-scraped, but with anchored patterns that cannot match
// anything except a call or a two-element array head.
for (const m of helpText.matchAll(/goToTerm\('([A-Za-z0-9_]+)'\)/g)) citedInMaps.add(m[1]);
for (const m of helpText.matchAll(/^\s*\['[^']*', '([A-Za-z0-9_]+)',$/gm)) citedInMaps.add(m[1]);
const badCites = [...citedInMaps].filter((t) => !G.TERMS[t]);
check('every screen-map and help-screen citation resolves', badCites.length === 0,
  badCites.join(', '));
check('the screen maps cite terms at all', citedInMaps.size > 5, String(citedInMaps.size));

console.log('\n--- the screen-map data ---');
check('a map exists for every screen worth mapping', SCREEN_ORDER.length === 4, SCREEN_ORDER.join(','));
check('every screen has a title, an intro and pins',
  SCREEN_ORDER.every((id) => {
    const s = SCREEN_DATA[id];
    return s.title && s.intro && Array.isArray(s.pins) && s.pins.length >= 4;
  }));
check('every pin is [title, body, termId] with real text',
  SCREEN_ORDER.every((id) => SCREEN_DATA[id].pins.every((p) => Array.isArray(p) && p.length === 3
    && typeof p[0] === 'string' && p[0].length > 3
    && typeof p[1] === 'string' && p[1].length > 40)),
  SCREEN_ORDER.filter((id) => SCREEN_DATA[id].pins.some((p) => !Array.isArray(p) || p.length !== 3
    || String(p[1]).length <= 40)).join(','));
check('every pin\'s term resolves',
  SCREEN_ORDER.every((id) => SCREEN_DATA[id].pins.every((p) => !p[2] || !!G.TERMS[p[2]])),
  SCREEN_ORDER.flatMap((id) => SCREEN_DATA[id].pins.filter((p) => p[2] && !G.TERMS[p[2]])
    .map((p) => `${id}:${p[2]}`)).join(', '));
check('a renderer exists for every mapped screen',
  SCREEN_ORDER.every((id) => new RegExp(`${id}:\\s*\\w+Map`).test(mapText)),
  SCREEN_ORDER.filter((id) => !new RegExp(`${id}:\\s*\\w+Map`).test(mapText)).join(','));
check('the maps say plainly that they are not screen captures',
  /SCHEMATICS, NOT SCREENSHOTS/i.test(mapText) && /schematics, not screen captures/i.test(helpText));

for (const t of citedInMaps) used.add(t);

// A term defined and referenced from nowhere is dead weight — it will not be maintained, and it will
// eventually be wrong. `seeAlso` counts as a reference, because a term reachable by following a link
// is reachable.
for (const id of ids) for (const s of G.TERMS[id].seeAlso || []) used.add(s);
const orphans = ids.filter((id) => !used.has(id));
check('every term is reachable from somewhere', orphans.length === 0,
  `unreferenced: ${orphans.join(', ')}`);

// ── Search ────────────────────────────────────────────────────────────────────
console.log('\n--- glossary search ---');

eq('an exact name ranks first', G.searchTerms('Holdout')[0].id, 'holdout');
check('a prefix matches', G.searchTerms('draw').some((t) => t.id === 'maxDrawdown'));
check('body text matches when the name does not',
  G.searchTerms('slippage').some((t) => t.id === 'costDrag'),
  G.searchTerms('slippage').map((t) => t.id).join(','));
check('an exact name outranks a passing mention in someone else\'s definition',
  G.searchTerms('ROI')[0].id === 'roi', G.searchTerms('ROI').slice(0, 3).map((t) => t.id).join(','));
eq('nonsense matches nothing', G.searchTerms('zzzqqq').length, 0);
eq('an empty query returns everything, so the panel is never blank',
  G.searchTerms('').length, ids.length);
check('search is case-insensitive',
  G.searchTerms('holdout')[0].id === G.searchTerms('HOLDOUT')[0].id);
check('results are unique', (() => {
  const r = G.searchTerms('a').map((t) => t.id);
  return new Set(r).size === r.length;
})());
eq('an unknown id resolves to null', G.term('nope'), null);
eq('a prototype key is not a term', G.term('__proto__'), null);
check('termsInGroup is alphabetical by display name',
  G.GROUPS.every((g) => {
    const list = G.termsInGroup(g.id).map((t) => t.term);
    return JSON.stringify(list) === JSON.stringify([...list].sort((a, b) => a.localeCompare(b)));
  }));
eq('an unknown group is empty rather than everything', G.termsInGroup('nope').length, 0);

for (const bad of [null, undefined, 0, {}, [], '__proto__']) {
  let threw = null;
  try { G.searchTerms(bad); G.term(bad); G.termsInGroup(bad); } catch (e) { threw = e.message; }
  check(`${JSON.stringify(bad)} is handled`, threw === null, threw);
}

// ── The claims the help screen makes about the product ────────────────────────
//
// The help screen tells master what StockMind will never do. If the code ever gains that ability the
// help becomes a false promise, which is worse than silence — so the promise is asserted against the
// code rather than trusted.
console.log('\n--- the help screen\'s promises still hold ---');

check('no-order-placement is stated in the glossary', !!G.TERMS.noOrders);
const backendFiles = ['electron/ipc/marketIntel.cjs', 'electron/preload.cjs'];
const orderWords = /place_?order|placeOrder|submitOrder|order_?entry|buy_?order|sell_?order/i;
const offenders = backendFiles.filter((f) => {
  try { return orderWords.test(fs.readFileSync(path.join(ROOT, f), 'utf8')); } catch { return false; }
});
check('no order-placement channel exists in the bridge or the preload', offenders.length === 0,
  offenders.join(', '));
check('the generated strategy code still states it places no orders', (() => {
  try {
    const cg = fs.readFileSync(path.join(ROOT, 'ai_backend', 'engine', 'strategy_codegen.py'), 'utf8');
    return /DOES NOT PLACE ORDERS/.test(cg);
  } catch { return false; }
})());
check('the news panel is still labelled not backtestable', (() => {
  const sm = read('StockMind.jsx');
  return /NOT BACKTESTABLE/.test(sm);
})());
check('the disclaimer is still present and non-removable', (() => {
  const sm = read('StockMind.jsx');
  return /Not\s*\n?\s*financial advice/i.test(sm) || /not financial advice/i.test(sm);
})());

console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
