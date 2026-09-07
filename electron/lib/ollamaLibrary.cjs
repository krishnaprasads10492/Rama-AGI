'use strict';

/**
 * ollamaLibrary.cjs — Rāma reading Ollama's own documents so its model list maintains itself.
 *
 * Master: *"RAMA should discern and populate list, include deprecation behavior for suggesting a new
 * items to replace the old ones."* Section 92 built the classification, scoring and cache but left
 * them fed by nothing. This fills them from source:
 *
 *   ollama.com/library?sort=newest  → families, capability tags, sizes, pulls, last-updated
 *   docs.ollama.com/cloud           → retirement tables, past and upcoming, with alternatives
 *
 * PARSING IS PURE AND TAKES TEXT. Tags are stripped first, so the same parser works on raw HTML and
 * on already-extracted text — a page served differently, or fetched through a different client, does
 * not become a new parser. The network call is injected, so every test runs offline.
 */

const catalog = require('./ollamaCatalog.cjs');

const LIBRARY_URL = 'https://ollama.com/library?sort=newest';
const RETIREMENT_URL = 'https://docs.ollama.com/cloud';

/**
 * A parse that collapses to under this fraction of what is already cached is treated as a parse
 * FAILURE, not as news that Ollama deleted its library.
 */
const COLLAPSE_FLOOR = 0.5;

/** Capability words Ollama prints as tags under each family. */
const TAG_WORDS = new Set(['tools', 'thinking', 'vision', 'cloud', 'audio', 'embedding']);

/**
 * Markup to text, ONE ELEMENT PER LINE.
 *
 * Tags become newlines rather than spaces, and that detail is the whole reason this works. With
 * spaces, `<a href="/library/glm-5.3">glm-5.3</a>` collapses to `/library/glm-5.3 glm-5.3` on one
 * line and the family name never matches a bare-slug test. One element per line also isolates the
 * `Pulls` / `Tags` / `Updated` footer values, which is what the parser anchors on.
 */
function stripTags(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '\n')
    .replace(/<style[\s\S]*?<\/style>/gi, '\n')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

/** `119.2M` → 119200000. Ollama abbreviates pull counts. */
function parseCount(raw) {
  const m = String(raw || '').match(/([\d.]+)\s*([KMB])?/i);
  if (!m) return 0;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return 0;
  const mult = { k: 1e3, m: 1e6, b: 1e9 }[String(m[2] || '').toLowerCase()] || 1;
  return Math.round(n * mult);
}

/** `1 year ago` → 365. `2 weeks ago` → 14. `yesterday` → 1. */
function parseAgeDays(raw) {
  const s = String(raw || '').toLowerCase().trim();
  if (/yesterday|today|hours? ago|minutes? ago/.test(s)) return 1;

  const m = s.match(/(\d+)\s*(day|week|month|year)/);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2];
  const per = { day: 1, week: 7, month: 30, year: 365 }[unit];
  return per ? n * per : null;
}

/**
 * Parse the library listing into `{ family: {cloud, tools, thinking, vision, pulls, sizes, ...} }`.
 *
 * Ollama's listing repeats a block per family: name, description, capability tags, size tags, a pull
 * count, a tag count, and a last-updated phrase. The blocks are split on the "Pulls / Tags / Updated"
 * footer, because that trio is the one structure present for every entry and absent everywhere else —
 * anchoring on it is far more durable than counting nested elements.
 */
function parseLibrary(input) {
  const text = stripTags(input).replace(/[ \t]+/g, ' ');
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  const out = {};
  let current = null;

  const flush = () => {
    if (current && current.family) {
      // Only keep entries that carried a footer; a stray heading is not a model.
      if (current.pulls > 0 || current.updatedDaysAgo !== null || current.sizes.length) {
        out[current.family] = {
          cloud: current.cloud,
          tools: current.tools,
          thinking: current.thinking,
          vision: current.vision,
          embedding: current.embedding,
          pulls: current.pulls,
          sizes: current.sizes,
          updatedDaysAgo: current.updatedDaysAgo,
          description: current.description || null,
        };
      }
    }
    current = null;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const low = line.toLowerCase();

    // ORDER IN THIS LOOP IS LOAD-BEARING, twice over, and both cases were found by testing:
    //
    //   `e4b` — one of gemma4's advertised builds — also satisfies the bare-slug shape of a family
    //   name. With the name test first it opened a block called `e4b` and DISCARDED gemma4. So sizes
    //   are tested before names.
    //
    //   `24.3M` — a PULL COUNT — also satisfies the size shape, because `M` for millions is
    //   indistinguishable from `m` for million-parameters. It was being eaten as a size tag, leaving
    //   pulls at 0 and the whole recency-versus-adoption score meaningless. The footer values are
    //   disambiguated by the line that FOLLOWS them (`Pulls`, `Tags`, `Updated`), which is context no
    //   lexical test can supply, so the footer is matched first.
    const next = lines[i + 1] || '';

    if (/^[\d.]+[kmb]?$/i.test(line) && /^pulls$/i.test(next)) {
      if (current) current.pulls = parseCount(line);
      continue;
    }
    if (/^[\d.]+$/.test(line) && /^tags?$/i.test(next)) continue;   // tag count, not a size

    const isSize = /^(?:\d+x)?[\d.]+[bm]$/i.test(line) || /^e\d+b$/i.test(line);
    if (isSize && current) { current.sizes.push(low); continue; }

    // A family name: a bare slug on its own line. Ollama names are lowercase with digits, dots and
    // dashes — `qwen3.5`, `glm-5.3-flash`, `minicpm-v4.6`, `nomic-embed-text`.
    if (!isSize && /^[a-z][a-z0-9]*(?:[.\-][a-z0-9]+)*$/.test(line) && !TAG_WORDS.has(low)
        && !/^(pulls|tags|updated|library|ago)$/.test(low) && line.length >= 3
        && !/^\d/.test(line)) {
      // A new name closes the previous block.
      flush();
      current = {
        family: low,
        cloud: false, tools: false, thinking: false, vision: false, embedding: false,
        pulls: 0, sizes: [], updatedDaysAgo: null, description: '',
      };
      continue;
    }

    if (!current) continue;

    if (TAG_WORDS.has(low)) {
      if (low === 'cloud') current.cloud = true;
      else if (low === 'tools') current.tools = true;
      else if (low === 'thinking') current.thinking = true;
      else if (low === 'vision') current.vision = true;
      else if (low === 'embedding') current.embedding = true;
      continue;
    }

    if (/^updated$/i.test(line) && lines[i + 1]) {
      current.updatedDaysAgo = parseAgeDays(lines[i + 1]);
      continue;
    }
    if (/^updated\s+.+ago$/i.test(line)) {
      current.updatedDaysAgo = parseAgeDays(line);
      continue;
    }

    // Anything else long enough is prose: the description.
    if (!current.description && line.length > 25 && /[a-z]\s[a-z]/i.test(line)) {
      current.description = line;
    }
  }
  flush();

  return out;
}

/**
 * Parse the retirement tables into `[{ model, alternative, date, past }]`.
 *
 * The page presents "Upcoming retirements" and "Past retirements" as date/model/alternative rows.
 * `past` is taken from which heading the row sat under rather than by comparing dates, because the
 * page is the authority on what has already happened and the machine clock may be wrong.
 */
function parseRetirements(input) {
  const text = stripTags(input).replace(/[ \t]+/g, ' ');
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  const rows = [];
  let past = false;
  let pendingDate = null;

  const DATE = /^(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}$/i;
  const MODEL = /^[a-z][a-z0-9]*(?:[.\-][a-z0-9]+)*(?::[a-z0-9.]+)?$/i;

  for (const line of lines) {
    if (/^upcoming retirements/i.test(line)) { past = false; pendingDate = null; continue; }
    if (/^past retirements/i.test(line)) { past = true; pendingDate = null; continue; }

    if (DATE.test(line)) { pendingDate = normaliseDate(line); continue; }

    // Rows arrive as `model` then `alternative`; a row may also be a lone model with no replacement.
    if (MODEL.test(line) && !/^(model|recommended|alternative|retirement|date)$/i.test(line)) {
      const last = rows[rows.length - 1];
      if (last && last.date === pendingDate && last.past === past && !last.alternative) {
        last.alternative = line;
      } else {
        rows.push({ model: line, alternative: null, date: pendingDate, past });
      }
    }
  }

  // A row with no date at all is not actionable — it cannot be reported as retired or upcoming.
  return rows.filter(r => r.date);
}

/**
 * `July 31, 2026` → `2026-07-31`, so stored dates sort and compare.
 *
 * Built from the parsed CALENDAR parts rather than via `toISOString()`. `Date.parse` treats a bare
 * date as local midnight, and east of UTC `toISOString()` then rolls it back a day — this machine
 * turned July 31 into 2026-07-30. A retirement date that silently drifts by one day is exactly the
 * kind of quiet wrongness that makes a warning arrive late.
 */
function normaliseDate(raw) {
  const d = new Date(String(raw));
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Fetch both documents, parse them, and update the cache — the "Rāma populates the list" half.
 *
 * @param {function} fetchText  `(url) => Promise<string>`, injected so tests never touch the network
 *
 * THE GUARD THAT MATTERS: a parse yielding zero families is REFUSED, never saved. The damaging
 * outcome here is a silent cache wipe — Ollama redesigns the page, the parser matches nothing, and an
 * empty catalogue replaces a working one, so retirement warnings stop firing and the shortlist goes
 * blank with every symptom pointing at the wrong cause. Yesterday's catalogue is strictly better.
 *
 * The two documents fail INDEPENDENTLY. A network error on the docs page must not discard a freshly
 * parsed library, so each half merges into the cached document on its own.
 */
async function refresh({ fetchText, now = new Date() } = {}) {
  if (typeof fetchText !== 'function') {
    return { ok: false, error: 'no fetcher supplied' };
  }

  const cached = catalog.loadCatalog({ now });
  const result = {
    ok: true,
    library: { ok: false, families: 0, reason: null },
    retirements: { ok: false, rows: 0, reason: null },
    saved: false,
  };

  let nextCatalog = cached.catalog;
  let nextSchedule = cached.schedule;

  // ── Library ───────────────────────────────────────────────────────────────
  try {
    const parsed = parseLibrary(await fetchText(LIBRARY_URL));
    const count = Object.keys(parsed).length;
    const known = Object.keys(cached.catalog).length;

    if (count === 0) {
      result.library.reason = 'parsed no families — keeping the cached catalogue rather than wiping it';
    } else if (known > 0 && count < known * COLLAPSE_FLOOR) {
      // Not treated as "Ollama deleted its library", because that is far less likely than a parser
      // that has stopped matching a changed page.
      result.library.reason = `parsed only ${count} of ${known} known families, which reads as a `
        + 'parse failure rather than a shrunken library — cached catalogue kept';
    } else {
      nextCatalog = parsed;
      result.library.ok = true;
      result.library.families = count;
    }
  } catch (err) {
    result.library.reason = `could not read the library: ${err.message}`;
  }

  // ── Retirement schedule ───────────────────────────────────────────────────
  try {
    const rows = parseRetirements(await fetchText(RETIREMENT_URL));
    if (rows.length === 0) {
      result.retirements.reason = 'parsed no retirement rows — keeping the cached schedule';
    } else {
      nextSchedule = rows;
      result.retirements.ok = true;
      result.retirements.rows = rows.length;
    }
  } catch (err) {
    result.retirements.reason = `could not read the retirement schedule: ${err.message}`;
  }

  // Only write when at least one half genuinely improved, so a total failure leaves `fetchedAt`
  // alone and the cache keeps reporting its true age rather than looking freshly refreshed.
  if (result.library.ok || result.retirements.ok) {
    catalog.saveCatalog({
      catalog: nextCatalog,
      schedule: nextSchedule,
      source: `${LIBRARY_URL} + ${RETIREMENT_URL}`,
      now,
    });
    result.saved = true;
  }

  result.ok = result.library.ok || result.retirements.ok;
  return result;
}

module.exports = {
  refresh, parseLibrary, parseRetirements,
  stripTags, parseCount, parseAgeDays, normaliseDate,
  LIBRARY_URL, RETIREMENT_URL, COLLAPSE_FLOOR,
};
