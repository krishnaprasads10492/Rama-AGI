#!/usr/bin/env node
/**
 * verifyDatasetsUi.mjs - what the candle-saving controls may say, and what they may do on their own (spec Section 153)
 *
 * The engine decides what is stored. This decides what master is TOLD, and the failure modes are in the telling:
 * candles he only looked at read as kept, a loaded snapshot read as live, a stale reply drawn over a newer one.
 * So the sentences and rules are pure functions (`datasetModel.js`) driven here with awkward input, and the
 * components are read as source for what a render cannot show: literal bridge calls, a confirmation before a
 * delete, no timers, no numeric font sizes, no trading words.
 *
 * Run: node scripts/verifyDatasetsUi.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as M from '../src/pages/StockMind/datasetModel.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SM = path.join(ROOT, 'src', 'pages', 'StockMind');
const read = (p) => fs.readFileSync(p, 'utf8');
let pass = 0;
let fail = 0;
const check = (label, ok, detail) => {
  if (ok) { pass += 1; console.warn(`  PASS  ${label}`); }
  else { fail += 1; console.warn(`  FAIL  ${label}${detail ? ` - ${detail}` : ''}`); }
};
const strings = (v, out = []) => {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => strings(x, out));
  return out;
};
const forbiddenIn = (text) => M.FORBIDDEN_WORDS.filter((w) => new RegExp(`\\b${w}\\b`, 'i').test(text));
const TODAY = new Date(2026, 9, 4);

// ── the name convention ──────────────────────────────────────────────────────────────────────────
console.warn('\n--- names: suggested, validated, and the same grammar as the engine and the bridge ---');
check('a name is SYMBOL.EXCHANGE.INTERVAL.YYYYMMDD.label',
  M.suggestName({ symbol: 'nifty50', exchange: 'nse', interval: '30M', label: 'pre-budget', today: TODAY }) === 'NIFTY50.NSE.30m.20261004.pre-budget');
check('the day is the machine\'s own calendar day, zero padded', M.ymd8(new Date(2026, 0, 2)) === '20260102');
check('an ampersand is made safe', M.suggestName({ symbol: 'M&M', exchange: 'NSE', interval: '1d', label: 'x', today: TODAY }) === 'M_M.NSE.1d.20261004.x');
check('a dot in the symbol cannot add a field', M.suggestName({ symbol: 'RELIANCE.NS', exchange: 'NSE', interval: '1d', label: 'x', today: TODAY }).split('.').length === 5);
check('a label with spaces and punctuation is made safe, not rejected',
  M.suggestName({ symbol: 'A', exchange: 'NSE', interval: '1d', label: 'my label!', today: TODAY }).endsWith('.my-label-'));
check('an over-long label is cut to 40', M.suggestName({ symbol: 'A', exchange: 'NSE', interval: '1d', label: 'q'.repeat(90), today: TODAY }).split('.')[4].length === 40);
check('an empty label becomes "snapshot"', M.suggestName({ symbol: 'A', exchange: 'NSE', interval: '1d', label: '', today: TODAY }).endsWith('.snapshot'));
const awkward = [undefined, null, '', ' ', '../../x', 'a b', 'é', '日本', 'x'.repeat(200), '^NSEI', 'BAJAJ-AUTO', '0', "x'; DROP"];
const allValid = awkward.every((s) => M.validName(M.suggestName({ symbol: s, exchange: s, interval: s, label: s, today: TODAY })).ok);
check('whatever is typed, a SUGGESTED name always passes validation', allValid,
  awkward.filter((s) => !M.validName(M.suggestName({ symbol: s, exchange: s, interval: s, label: s, today: TODAY })).ok).join('|'));
check('suggesting with no arguments does not throw', typeof M.suggestName() === 'string' && M.validName(M.suggestName()).ok);

const GOOD = 'NIFTY50.NSE.1d.20261004.pre-budget';
const hostile = ['../x', '..\\x', 'a b', 'NIFTY 50.NSE.1d.20261004.x', 'NIFTY50.N SE.1d.20261004.x', 'NIFTY50.NSE.1 d.20261004.x',
  'NIFTY50.NSE.1d.2026 004.x', 'NIFTY50.NSE.1d.20261004.x y', `${GOOD}/x`, `${GOOD}\\x`, `${GOOD}\n`, 'NIFTY50.NSE.1d.20261004.\u00e9t\u00e9', 'NIFTY50.NSE.1d.20261004.\u0661\u0662',
  'NIFTY50.NSE.1d.\u0662\u0660\u0662\u0666\u0661\u0660\u0660\u0664.x', "NIFTY50.NSE.1d.20261004.x'; DROP TABLE datasets;--", 'NIFTY50.NSE.1d.20261004.',
  'NIFTY50.NSE.1d.20261304.x', 'NIFTY50.NSE.1d.20260230.x', 'NIFTY50.NSE.1d.2026-10-04.x', 'nifty50.NSE.1d.20261004.x', 'NIFTY50.NSE.1D.20261004.x',
  `NIFTY50.NSE.1d.20261004.${'a'.repeat(41)}`, '', ' ', null, undefined, 5, ['a'], {}, 'C:\\evil', '/etc/passwd', 'x'.repeat(400)];
check('every hostile name is refused, with a sentence', hostile.every((h) => { const v = M.validName(h); return v.ok === false && typeof v.why === 'string' && v.why.length > 10; }),
  hostile.filter((h) => M.validName(h).ok).map(String).join('|'));
check('a good name passes', M.validName(GOOD).ok === true && M.validName(GOOD).why === null);
check('a 40-character label passes, a 41-character one does not',
  M.validName(`A.NSE.1d.20260101.${'a'.repeat(40)}`).ok && !M.validName(`A.NSE.1d.20260101.${'a'.repeat(41)}`).ok);
check('a leap day is real in a leap year and not otherwise', M.validName('A.NSE.1d.20240229.x').ok && !M.validName('A.NSE.1d.20250229.x').ok);
check('a label alone is checked', M.validLabel('ok-label_1') && !M.validLabel('no good') && !M.validLabel('') && !M.validLabel(null) && !M.validLabel('a'.repeat(41)));

// The bridge carries its own copy of the grammar. Extracted from source and run against the same names, so
// the two cannot quietly disagree about what a valid name is.
const bridge = read(path.join(ROOT, 'electron/ipc/marketIntel.cjs'));
const lit = /const DATASET_NAME = \/(.+)\/;/.exec(bridge);
const bridgeRe = lit ? new RegExp(lit[1]) : null;
check('the bridge grammar was found', !!bridgeRe);
const samples = [...hostile, GOOD, 'A.NSE.1d.20240229.x', 'A.NSE.1d.20250229.x', 'M_M.NSE.5m.20261004.x', `A.NSE.1d.20260101.${'a'.repeat(40)}`];
const disagree = bridgeRe ? samples.filter((s) => typeof s === 'string' && M.validName(s).ok && !bridgeRe.test(s)) : samples;
check('everything the window accepts, the bridge accepts (the bridge is the looser check; the date is the engine\'s)', disagree.length === 0, disagree.join('|'));
const stricter = bridgeRe ? samples.filter((s) => typeof s === 'string' && bridgeRe.test(s) && !M.validName(s).ok) : [];
check('and the only names the bridge passes that the window refuses are impossible dates, which the engine refuses',
  stricter.every((s) => /\.2026(1304|0230)\./.test(s) || /\.20250229\./.test(s)), stricter.join('|'));
const py = read(path.join(ROOT, 'ai_backend', 'engine', 'datasets.py'));
check('the engine states the same character classes and lengths',
  /\[A-Z0-9_-\]\{1,%d\}/.test(py) && /_PART % 20/.test(py) && /_PART % 12/.test(py) && /\[a-z0-9_-\]\{1,8\}/.test(py)
  && /\[0-9\]\{8\}/.test(py) && /\[A-Za-z0-9_-\]\{1,"\s*\+\s*str\(MAX_LABEL\)/.test(py) && M.MAX_LABEL === 40 && /MAX_LABEL = 40/.test(py));
check('and the same cap on bars', /MAX_BARS = 50000/.test(py) && M.MAX_BARS === 50000);

// ── NOT SAVED ────────────────────────────────────────────────────────────────────────────────────
console.warn('\n--- NOT SAVED: shown exactly when the engine says the candles are not on disk ---');
check('persisted:false is unsaved', M.isUnsaved({ persisted: false }) === true);
for (const [label, v] of [['persisted:true', { persisted: true }], ['no field', {}], ['null reply', null], ['undefined', undefined], ['the string "false"', { persisted: 'false' }], ['0', { persisted: 0 }]]) {
  check(`${label} is NOT unsaved (a missing fact never raises a false alarm, nor hides a true one)`, M.isUnsaved(v) === false);
}
check('the badge says NOT SAVED and explains', M.unsavedBadge(true).show && M.unsavedBadge(true).label === 'NOT SAVED' && /not on disk/.test(M.unsavedBadge(true).tip));
check('and shows nothing when everything is on disk', M.unsavedBadge(false).show === false && M.unsavedBadge(false).label === '');

// ── the request-sequence guard ───────────────────────────────────────────────────────────────────
console.warn('\n--- the request-sequence guard: an older reply never overwrites a newer one ---');
const seq = M.createSequence();
const a = seq.next();
const b = seq.next();
check('the newest request is current', seq.isCurrent(b));
check('the older one is not, even though it is the one that has not returned', !seq.isCurrent(a));
const c = seq.next();
check('a third supersedes both', !seq.isCurrent(a) && !seq.isCurrent(b) && seq.isCurrent(c));
check('an id that was never issued is never current', !seq.isCurrent(0) && !seq.isCurrent(99) && !seq.isCurrent(undefined) && !seq.isCurrent(null));
const s2 = M.createSequence();
check('sequences are independent', s2.next() === 1 && seq.isCurrent(c));
// The scenario itself, replayed: slow reply for request 1 arrives after request 2's.
const screen = [];
const sq = M.createSequence();
const r1 = sq.next();
const r2 = sq.next();
const land = (id, label) => { if (sq.isCurrent(id)) screen.push(label); };
land(r2, 'new instrument');
land(r1, 'OLD instrument');
check('replayed: the slow old reply is dropped and the screen keeps the new one', screen.join() === 'new instrument', screen.join());

// ── the save form ────────────────────────────────────────────────────────────────────────────────
console.warn('\n--- the save form says exactly what it will keep ---');
const mk = (n, start = '2026-01-01') => Array.from({ length: n }, (_, i) => ({ date: `${start.slice(0, 8)}${String(1 + i).padStart(2, '0')}`, open: 1, high: 2, low: 1, close: 1.5, volume: 10 }));
const sum = M.saveSummary({ symbol: 'nifty50', interval: '1d', bars: mk(30) });
check('the sentence gives the count, the symbol, the interval and the span', /30 candles of NIFTY50 at 1d, 2026-01-01 to 2026-01-30/.test(sum), sum);
check('and says the working store is not changed', /working store is not changed/.test(sum));
check('one candle is singular', /1 candle of/.test(M.saveSummary({ symbol: 'A', interval: '1d', bars: mk(1) })));
check('a date filter is reported', /date filter is 2026-01-05 to now/.test(M.saveSummary({ symbol: 'A', interval: '1d', fromDate: '2026-01-05', bars: mk(3) })));
check('unsaved candles are called out as not on disk', /fetched for viewing and are not on disk/.test(M.saveSummary({ symbol: 'A', interval: '1d', bars: mk(3), unsaved: true })));
check('candles that are on disk are not so labelled', !/not on disk/.test(M.saveSummary({ symbol: 'A', interval: '1d', bars: mk(3), unsaved: false })));
check('intraday stamps are reported by day', /2026-01-01 to 2026-01-02/.test(M.saveSummary({ symbol: 'A', interval: '5m', bars: [{ date: '2026-01-01 09:15:00' }, { date: '2026-01-02 15:25:00' }] })));
check('no candles: says so, and does not invent a span', M.saveSummary({ symbol: 'A', interval: '1d', bars: [] }) === 'There are no candles on screen to save.' && M.saveSummary() === 'There are no candles on screen to save.');

const form = (o = {}) => M.saveFormView({ symbol: 'NIFTY50', exchange: 'NSE', interval: '1d', label: 'pre-budget', name: '', nameEdited: false, bars: mk(10), canRequest: true, busy: false, today: TODAY, ...o });
check('a normal form can save, under the suggested name', form().canSave && form().name === GOOD && form().why === null, JSON.stringify(form()));
check('a tier that may only look cannot save, and is told why', !form({ canRequest: false }).canSave && /not create them/.test(form({ canRequest: false }).why));
check('no candles: cannot save, and says so', !form({ bars: [] }).canSave && /no candles/.test(form({ bars: [] }).why));
check('nothing at all: cannot save', !form({ bars: undefined }).canSave);
check('over 50,000 candles: cannot save, asks to narrow the dates', !form({ bars: new Array(50001).fill({}) }).canSave && /Narrow the dates/.test(form({ bars: new Array(50001).fill({}) }).why));
check('exactly 50,000 is allowed', form({ bars: new Array(50000).fill({}) }).canSave);
check('a bad label blocks the save', !form({ label: 'has space' }).canSave && /label/i.test(form({ label: 'has space' }).why));
check('an empty label blocks the save', !form({ label: '' }).canSave);
check('an edited name is used as typed', form({ nameEdited: true, name: 'NIFTY50.NSE.1d.20261005.other' }).name === 'NIFTY50.NSE.1d.20261005.other');
check('and a bad edited name blocks the save with the reason', !form({ nameEdited: true, name: '../x' }).canSave && /SYMBOL\.EXCHANGE/.test(form({ nameEdited: true, name: '../x' }).why));
check('an edited name does not need the label to be valid', form({ nameEdited: true, name: GOOD, label: '!!!' }).canSave);
check('while saving it cannot be pressed twice', !form({ busy: true }).canSave);
check('with no arguments it does not throw', M.saveFormView().canSave === false);

// ── replies ──────────────────────────────────────────────────────────────────────────────────────
console.warn('\n--- replies: unwrapped, and every refusal in plain words ---');
check('a bridge failure becomes a refusal', M.unwrap({ ok: false, error: 'Access denied' }).ok === false && M.unwrap({ ok: false, error: 'Access denied' }).reason === 'Access denied');
check('a bridge refusal keeps its reason', M.unwrap({ ok: false, reason: 'that is not a dataset name' }).reason === 'that is not a dataset name');
check('an engine reply is passed through', M.unwrap({ ok: true, data: { ok: true, name: GOOD } }).name === GOOD);
check('an engine refusal inside a successful call is still a refusal', M.unwrap({ ok: true, data: { ok: false, code: 'exists', reason: 'x' } }).ok === false);
for (const bad of [null, undefined, 5, 'x', {}, { ok: true }, { ok: true, data: null }, { ok: true, data: 'x' }]) {
  check(`a malformed reply (${JSON.stringify(bad)}) is a refusal, not an exception`, M.unwrap(bad).ok === false);
}
const codes = ['exists', 'bad-name', 'bad-label', 'name-mismatch', 'empty', 'too-many', 'bad-bars', 'missing', 'io'];
check('every refusal code has its own sentence', codes.every((c) => M.refusalSentence({ code: c, reason: 'engine says' }) !== 'engine says' && M.refusalSentence({ code: c }).length > 20));
check('"exists" tells master how to proceed', /overwrite/.test(M.refusalSentence({ code: 'exists' })));
check('an unknown code falls back to the engine\'s reason, then to a default', M.refusalSentence({ code: 'zzz', reason: 'because' }) === 'because' && M.refusalSentence({}) === 'The request failed.' && M.refusalSentence(null) === 'The request failed.');
check('a save is reported with its count', /Saved NIFTY50\.NSE\.1d\.20261004\.pre-budget: 30 candles\./.test(M.savedSentence({ name: GOOD, bars: 30 })));
check('an overwrite says it replaced one', /replacing the earlier one/.test(M.savedSentence({ name: GOOD, bars: 30, overwritten: true })));
check('and a note from the engine about moved data is passed on', /data has moved on/.test(M.savedSentence({ name: GOOD, bars: 30, note: 'The chart showed 5 bars but the data has moved on: 30 were saved.' })));

console.warn('\n--- the list and the banner ---');
const rows = M.datasetRows([{ name: GOOD, bars: 1234, savedAt: '2026-10-04T10:00:00Z', firstBar: '2026-01-01', lastBar: '2026-10-01', source: 'yahoo', note: 'before' }, { name: 'B.NSE.1d.20260101.x' }]);
check('each row carries name, count, span, saved day and source', rows[0].name === GOOD && /1,234 candles/.test(rows[0].bars) && rows[0].span === '2026-01-01 to 2026-10-01' && rows[0].saved === '2026-10-04' && rows[0].source === 'yahoo');
check('a row with missing figures shows dashes and "unknown source", never zero or undefined', rows[1].span === '—' && rows[1].saved === '—' && rows[1].source === 'unknown source' && /0 candles/.test(rows[1].bars) && !strings(rows[1]).some((s) => /undefined|null|NaN/.test(s)));
check('the delete question names the dataset and says the working store is safe', rows[0].deleteQuestion.includes(GOOD) && /working store is not affected/.test(rows[0].deleteQuestion));
check('a missing or malformed list is an empty list', M.datasetRows(null).length === 0 && M.datasetRows(undefined).length === 0 && M.datasetRows('x').length === 0);
check('the banner reads exactly: SAVED DATASET <name> — read-only snapshot', M.bannerText({ name: GOOD }) === `SAVED DATASET ${GOOD} — read-only snapshot`);
check('the banner does not throw without a dataset', typeof M.bannerText(null) === 'string');
check('the way back is called "Back to live"', M.BANNER_BACK === 'Back to live' && /do not change when you fetch/.test(M.BANNER_SENTENCE));

console.warn('\n--- the buttons keep their honesty ---');
check('the four fetch actions have the labels master named',
  M.LABELS.fromDisk === '↺ From disk' && M.LABELS.fetchView === '⇩ Fetch (view only)' && M.LABELS.fetchKeep === '⇩ Fetch & keep for analysis' && M.LABELS.save === '💾 Save dataset…');
check('view-only says nothing is written', /Nothing is written to disk/.test(M.TIPS.fetchView));
check('keep says it feeds strategy and training', /Strategy, training and outcomes read this store/.test(M.TIPS.fetchKeep));
check('a loaded dataset is said not to feed strategy', /does not feed strategy or training/.test(M.TIPS.saved));
const everything = [...strings(M.LABELS), ...strings(M.TIPS), ...strings(form()), ...strings(M.unsavedBadge(true)), M.bannerText({ name: GOOD }), M.BANNER_SENTENCE, M.BANNER_BACK, M.NOT_SAVED,
  ...codes.map((c) => M.refusalSentence({ code: c })), M.savedSentence({ name: GOOD, bars: 3, overwritten: true }), sum,
  M.validName('x').why, M.validName('A.NSE.1d.20260230.x').why, ...rows.flatMap((r) => strings(r))];
const bad = everything.filter((s) => forbiddenIn(s).length);
check('no sentence this feature can say contains buy, sell or order', bad.length === 0, bad.join(' | '));

// ── source: what the components do ───────────────────────────────────────────────────────────────
console.warn('\n--- source: literal calls, one confirmation, no timers, no numeric sizes ---');
const panel = read(path.join(SM, 'DatasetPanel.jsx'));
const stock = read(path.join(SM, 'StockMind.jsx'));
const pre = read(path.join(ROOT, 'electron/preload.cjs'));
for (const m of ['datasetList', 'datasetLoad', 'datasetSave', 'datasetDelete']) {
  check(`window.rama.marketIntel.${m}( is called by name (the reachability audit reads literals)`, new RegExp(`window\\.rama\\.marketIntel\\.${m}\\(`).test(panel));
  check(`preload exposes ${m}`, new RegExp(`\\b${m}:\\s*\\(opts\\)\\s*=>\\s*ipcRenderer\\.invoke\\('market:dataset-`).test(pre));
}
const del = panel.indexOf('window.rama.marketIntel.datasetDelete(');
const conf = panel.indexOf('window.confirm(');
check('deleting asks first: a confirmation precedes the delete call and returns on refusal', conf > 0 && conf < del && /if \(!window\.confirm\([^)]*\)\) return;/.test(panel));
check('there is exactly one delete call site', (panel.match(/marketIntel\.datasetDelete\(/g) || []).length === 1);
const effects = [...panel.matchAll(/useEffect\(\(\) => \{([\s\S]*?)\}, \[/g)].map((m) => m[1]).join('\n');
check('there is an effect to inspect', effects.length > 20);
check('save, load and delete are click handlers, never inside an effect', !/marketIntel\.dataset(Save|Load|Delete)/.test(effects) && !/\brefresh\(\)[\s\S]*datasetSave/.test(effects));
check('the list is read when a panel opens, not on a clock', /useEffect\(\(\) => \{\s*if \(mode === 'list' \|\| mode === 'save'\) refresh\(\);/.test(panel));
const mine = { 'DatasetPanel.jsx': panel, 'datasetModel.js': read(path.join(SM, 'datasetModel.js')) };
for (const [f, text] of Object.entries(mine)) {
  check(`${f}: no timers`, !/setInterval|setTimeout|requestAnimationFrame/.test(text));
  check(`${f}: no console logging`, !new RegExp(['console', 'log'].join('\\.')).test(text));
  check(`${f}: no unfinished-work markers or placeholder text`,
    !new RegExp(`\\b(${['TO' + 'DO', 'FIX' + 'ME', 'X' + 'XX', 'place' + 'holder'].join('|')})\\b`, 'i').test(text.replace(/placeholder=/g, '')));
  const body = text.split('\n').filter((l) => !/FORBIDDEN_WORDS = /.test(l)).join('\n');
  check(`${f}: no buy, sell or order anywhere, comments included`, forbiddenIn(body).length === 0, forbiddenIn(body).join(','));
  check(`${f}: no numeric font size`, !/fontSize\s*:\s*['"]?\d/.test(text) && !/font-size\s*:\s*\d/.test(text));
  check(`${f}: no numeric line height`, !/lineHeight\s*:\s*['"]?\d/.test(text));
}
check('DatasetPanel sizes its type with FS and LH tokens', /fontSize: FS\./.test(panel) && /lineHeight: LH\./.test(panel) && /from '@config\/type\.js'/.test(panel));
check('DatasetPanel never reaches the engine for analysis: no predict, backtest, evolve or keep',
  !/marketIntel\.(predict|backtest|strategy|book|ohlcv|train)/.test(panel));
check('it never sends candles: no bars key in the save call', !/datasetSave\(\{[^}]*\bbars\b\s*[:,]/.test(panel.replace(/expectBars:[^,}]*/g, '')));
check('its only saved-bars use is loading a snapshot to draw', /onView\(\{ meta: res\.dataset, bars: res\.bars \|\| \[\] \}\)/.test(panel));
for (const id of ['datasetName', 'savedDataset']) check(`DatasetPanel references <InfoTip id="${id}" /> literally`, new RegExp(`<InfoTip id="${id}" />`).test(panel));
for (const id of ['fetchView', 'fetchProvider', 'notSaved']) check(`StockMind references <InfoTip id="${id}" /> literally`, new RegExp(`<InfoTip id="${id}" />`).test(stock));

console.warn('\n--- source: StockMind wires it without losing what it had ---');
check('no chart empty-state fetch still persists: the old loadBars(true) is gone', !/loadBars\(true\)/.test(stock));
check('both chart empty-state actions are view-only', (stock.match(/onFetch=\{[^}]*loadBars\(true, false\)\}/g) || []).length === 2);
check('"Fetch (view only)" calls loadBars(true, false) and "Fetch & keep" calls loadBars(true, true)',
  /onClick=\{\(\) => loadBars\(true, false\)\}\s*title=\{TIPS\.fetchView\}/.test(stock) && /onClick=\{\(\) => loadBars\(true, true\)\}\s*title=\{TIPS\.fetchKeep\}/.test(stock));
check('"From disk" is unchanged: a read with no sync', /onClick=\{\(\) => loadBars\(false\)\}\s*title=\{TIPS\.fromDisk\}/.test(stock));
check('the fetch passes persist to the bridge', /marketIntel\.ohlcv\(\{[\s\S]{0,400}persist,/.test(stock));
check('loadBars takes a sequence number before any await and checks it straight after',
  /const mine = barsSeq\.current\.next\(\);[\s\S]{0,1200}await window\.rama\.marketIntel\.ohlcv[\s\S]{0,900}if \(!barsSeq\.current\.isCurrent\(mine\)\) return;\s*setBarsBusy\(false\);/.test(stock));
check('the stale-reply return comes before any state is set from the reply', stock.indexOf('isCurrent(mine)') < stock.indexOf('setBars(res.data?.bars'));
check('NOT SAVED is derived from the reply, not from which button was pressed', /const unsaved = isUnsaved\(res\.data\);\s*setBarsUnsaved\(unsaved\);/.test(stock));
check('the badge shows next to the buttons and on the chart header', (stock.match(/badge\.show &&/g) || []).length === 2);
check('a new instrument clears the NOT SAVED state', /setBars\(\[\]\);\s*setBarsMeta\(null\);\s*setBarsUnsaved\(false\);/.test(stock));
check('a loaded snapshot is drawn read-only: no cone, no signal, no fills', /signal=\{snap \? null : selected\}/.test(stock) && /cone=\{snap \? null : cone\}/.test(stock) && /fills=\{snap \? \[\] : /.test(stock));
check('and neither chart offers a fetch while a snapshot shows (a fetch would change what the banner says)', (stock.match(/onFetch=\{snap \? null :/g) || []).length === 2);
check('the snapshot banner is shown above both charts', (stock.match(/<SnapshotBanner meta=\{snap \? snap\.meta : null\}/g) || []).length === 2);
check('any parameter change leaves the snapshot', /setViewDataset\(null\);\s*if \(inElectron && canView\) \{/.test(stock));
check('Save is disabled while a snapshot is showing, and with no candles', /disabled=\{!canView \|\| !bars\.length \|\| !!viewDataset\}/.test(stock));
check('the old "Fetch from provider" label is gone from the UI', !/Fetch from provider/.test(stock) && !/Fetch from provider/.test(read(path.join(SM, 'HelpPanel.jsx'))));

console.warn(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
