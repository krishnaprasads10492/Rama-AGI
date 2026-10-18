/**
 * datasetModel.js - what the candle-saving controls say, as data (spec Section 153)
 *
 * Showing candles and keeping candles are different acts. The chart shows a VIEW; a dataset is a named
 * snapshot master chose to keep. The risk in the telling is a screen that lets him believe the wrong one:
 * bars he fetched for a look are not on disk, and a dataset he loaded is not what the engine analyses.
 * So every sentence about that is made HERE, in plain functions `scripts/verifyDatasetsUi.mjs` can drive
 * with awkward input, and the components only lay them out.
 *
 * WHAT THIS FILE HOLDS
 *   - The name convention, in the same grammar the engine (`datasets.py`) and the bridge enforce:
 *     SYMBOL.EXCHANGE.INTERVAL.YYYYMMDD.label. Three checks of one grammar, so a name that passes here is
 *     not rejected later for a reason master was never shown.
 *   - The NOT SAVED rule: bars are unsaved exactly when the engine said they include provider data that
 *     is not on disk.
 *   - The request-sequence guard: a slow earlier reply must never overwrite a later one.
 *   - Plain sentences for every refusal. Nothing here is an instruction to trade.
 */

export const NOT_SAVED = 'NOT SAVED';
export const FORBIDDEN_WORDS = ['buy', 'sell', 'order'];
export const MAX_BARS = 50000;
export const MAX_LABEL = 40;

export const LABELS = {
  fromDisk: '↺ From disk',
  fetchView: '⇩ Fetch (view only)',
  fetchKeep: '⇩ Fetch & keep for analysis',
  save: '💾 Save dataset…',
  saved: '📂 Saved datasets',
};

export const TIPS = {
  fromDisk: 'Read bars already stored on this machine. No network.',
  fetchView: 'Ask the data providers for the latest candles and show them. Nothing is written to disk, so strategy and training do not see them.',
  fetchKeep: 'Ask the provider chain for anything missing and store it. Strategy, training and outcomes read this store. Reaches back as far as the provider allows, which for intraday is a few days to two years.',
  save: 'Keep exactly the candles on screen under a name, to look at again later. The working store is not changed.',
  saved: 'Candles you saved under a name. Loading one draws it read-only; it does not feed strategy or training.',
};

// ── the name convention ───────────────────────────────────────────────────────────────────────────
const NAME_RE = /^[A-Z0-9_-]{1,20}\.[A-Z0-9_-]{1,12}\.[a-z0-9_-]{1,8}\.[0-9]{8}\.[A-Za-z0-9_-]{1,40}$/;
const LABEL_RE = /^[A-Za-z0-9_-]{1,40}$/;

/** A symbol, exchange or interval made safe for a name. '.' is the separator, so it can never survive. */
export function cleanPart(value, width, lower = false) {
  const s = String(value == null ? '' : value).trim().replace(/[^A-Za-z0-9_-]/g, '_').slice(0, width) || 'X';
  return lower ? s.toLowerCase() : s.toUpperCase();
}

/** YYYYMMDD in the machine's own calendar day, which is the day master means by "today". */
export function ymd8(d) {
  const t = d instanceof Date && !Number.isNaN(d.getTime()) ? d : new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${t.getFullYear()}${pad(t.getMonth() + 1)}${pad(t.getDate())}`;
}

/** The name proposed for these parameters. A label that is not valid is made safe, never rejected here. */
export function suggestName({ symbol, exchange, interval, label, today } = {}) {
  const lab = String(label == null ? '' : label).trim().replace(/[^A-Za-z0-9_-]/g, '-').slice(0, MAX_LABEL) || 'snapshot';
  return `${cleanPart(symbol, 20)}.${cleanPart(exchange, 12)}.${cleanPart(interval, 8, true)}.${ymd8(today)}.${lab}`;
}

export function validLabel(label) {
  return typeof label === 'string' && LABEL_RE.test(label);
}

/** {ok, why}. The date part must be a real calendar date, as the engine checks. */
export function validName(name) {
  if (typeof name !== 'string') return { ok: false, why: 'A dataset name is text.' };
  if (!NAME_RE.test(name)) {
    return { ok: false, why: 'Names look like SYMBOL.EXCHANGE.INTERVAL.YYYYMMDD.label, where the label is 1 to 40 letters, digits, - or _.' };
  }
  const d = name.split('.')[3];
  const y = Number(d.slice(0, 4));
  const m = Number(d.slice(4, 6));
  const day = Number(d.slice(6, 8));
  const t = new Date(Date.UTC(y, m - 1, day));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== day) {
    return { ok: false, why: 'The date part of the name is not a real date.' };
  }
  return { ok: true, why: null };
}

// ── is what is on screen saved? ───────────────────────────────────────────────────────────────────
/** True only when the engine says the bars include provider data that is not on disk. */
export function isUnsaved(reply) {
  return !!reply && reply.persisted === false;
}

export function unsavedBadge(unsaved) {
  return unsaved
    ? { show: true, label: NOT_SAVED, tip: 'These candles came from a view-only fetch. They are on screen, not on disk; nothing was written.' }
    : { show: false, label: '', tip: '' };
}

// ── the request-sequence guard ────────────────────────────────────────────────────────────────────
/**
 * Each request takes a number; only the newest number may update the screen. Without it a slow earlier
 * reply landed after a faster later one and put the old instrument's candles under the new name.
 */
export function createSequence() {
  let latest = 0;
  return {
    next() { latest += 1; return latest; },
    isCurrent(id) { return id === latest; },
  };
}

// ── the save form ─────────────────────────────────────────────────────────────────────────────────
const dayOf = (s) => String(s || '').slice(0, 10);
const plural = (n, w) => `${n.toLocaleString('en-IN')} ${w}${n === 1 ? '' : 's'}`;

/** Exactly what a save will keep, in one sentence, from the bars that are on screen. */
export function saveSummary({ symbol, interval, fromDate, toDate, bars, unsaved } = {}) {
  const n = Array.isArray(bars) ? bars.length : 0;
  if (n === 0) return 'There are no candles on screen to save.';
  const first = dayOf(bars[0] && bars[0].date);
  const last = dayOf(bars[n - 1] && bars[n - 1].date);
  const win = fromDate || toDate ? ` The date filter is ${fromDate || 'the start'} to ${toDate || 'now'}.` : '';
  const view = unsaved ? ' These candles were fetched for viewing and are not on disk; the snapshot keeps them anyway.' : '';
  return `Saves ${plural(n, 'candle')} of ${String(symbol || '').toUpperCase()} at ${interval}, ${first} to ${last}, as drawn.${win}${view} The working store is not changed.`;
}

/** Everything the form needs to render and decide whether Save is allowed. */
export function saveFormView({ symbol, exchange, interval, label, name, nameEdited, bars, canRequest, busy, today } = {}) {
  const n = Array.isArray(bars) ? bars.length : 0;
  const suggested = suggestName({ symbol, exchange, interval, label, today });
  const useName = nameEdited ? String(name == null ? '' : name) : suggested;
  const nameCheck = validName(useName);
  const labelOk = nameEdited ? true : validLabel(label);
  let why = null;
  if (!canRequest) why = 'Your tier can look at saved datasets but not create them.';
  else if (n === 0) why = 'There are no candles on screen to save.';
  else if (n > MAX_BARS) why = `A dataset holds at most ${MAX_BARS.toLocaleString('en-IN')} candles. Narrow the dates.`;
  else if (!labelOk) why = 'A label is 1 to 40 letters, digits, - or _.';
  else if (!nameCheck.ok) why = nameCheck.why;
  else if (busy) why = 'Saving…';
  return { name: useName, suggested, nameOk: nameCheck.ok, canSave: why === null, why };
}

/** The engine's reply (or the bridge's refusal) as a plain object, whichever shape it arrived in. */
export function unwrap(res) {
  if (!res || typeof res !== 'object') return { ok: false, reason: 'No reply came back.' };
  if (res.ok === false) return { ok: false, code: res.code, reason: res.reason || res.error || 'The request failed.' };
  const d = res.data;
  if (!d || typeof d !== 'object') return { ok: false, reason: 'No reply came back.' };
  return d;
}

const REFUSALS = {
  exists: 'A dataset with that name already exists. Tick overwrite to replace it, or change the label.',
  'bad-name': 'That is not a valid dataset name.',
  'bad-label': 'A label is 1 to 40 letters, digits, - or _.',
  'name-mismatch': 'The name must start with this instrument and interval.',
  empty: 'There are no candles to save for these settings.',
  'too-many': 'That is more candles than one dataset may hold. Narrow the dates.',
  'bad-bars': 'The candles could not be saved because some were malformed.',
  missing: 'That dataset no longer exists.',
  io: 'The dataset file could not be written. Nothing was saved.',
};

/** One sentence for a refusal. The engine's own reason is kept when there is no better one. */
export function refusalSentence(reply) {
  const r = reply || {};
  return REFUSALS[r.code] || r.reason || r.error || 'The request failed.';
}

export function savedSentence(reply) {
  const r = reply || {};
  const base = `Saved ${r.name}: ${plural(Number(r.bars) || 0, 'candle')}${r.overwritten ? ', replacing the earlier one' : ''}.`;
  return r.note ? `${base} ${r.note}` : base;
}

// ── the saved-datasets list ───────────────────────────────────────────────────────────────────────
export function datasetRows(list) {
  const rows = Array.isArray(list) ? list : [];
  return rows.map((d) => ({
    name: String(d.name),
    bars: plural(Number(d.bars) || 0, 'candle'),
    saved: dayOf(d.savedAt) || '—',
    span: d.firstBar && d.lastBar ? `${dayOf(d.firstBar)} to ${dayOf(d.lastBar)}` : '—',
    source: d.source ? String(d.source) : 'unknown source',
    note: d.note ? String(d.note) : '',
    deleteQuestion: `Delete the saved dataset "${d.name}"? Its ${plural(Number(d.bars) || 0, 'candle')} are removed. The working store is not affected.`,
  }));
}

export function bannerText(meta) {
  return `SAVED DATASET ${meta && meta.name ? meta.name : ''} — read-only snapshot`;
}

export const BANNER_BACK = 'Back to live';
export const BANNER_SENTENCE = 'These candles are a saved copy. They do not change when you fetch, and strategy and training do not use them.';
