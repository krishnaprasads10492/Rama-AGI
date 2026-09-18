/**
 * symbols.js — what master can pick from, and where each name comes from.
 *
 * WHY (spec Section 101). SYMBOL was a free-text box. A typo does not read as a typo: the request
 * succeeds, the store has nothing under `RELAINCE`, and the chart says "no bars" — the same message
 * a real symbol with no history produces. So the most common mistake presented as a data problem.
 *
 * TWO SOURCES, AND THE DIFFERENCE IS STATED, NOT BLENDED.
 *
 *   held    — read from `/store/inventory`: series Rāma actually has on disk. Selecting one of these
 *             draws immediately with no network call.
 *   known   — a seed list of names the provider chain can RESOLVE. `providers.to_yahoo_symbol` maps
 *             these to real Yahoo tickers, so they are fetchable, but nothing has been fetched yet.
 *
 * A third class deliberately does NOT exist: a full exchange instrument master. NSE lists ~2,000
 * symbols and there is no free endpoint this project already talks to that serves the list, so
 * inventing one would mean a new provider, a new cache and a new refresh policy. Until that is a
 * decision master makes, FREE TEXT REMAINS — the dropdown is a shortcut, never a gate (I11). A
 * picker that cannot express a symbol master wants would be a downgrade from a text box.
 *
 * The `known` list below is the JS side of `providers.YAHOO_SYMBOLS` plus the large NSE names. It is
 * a convenience list, not an authority: `scripts/verifySymbols.mjs` asserts every mapped name here
 * exists in the Python map, so the dropdown cannot offer a name the engine would fail to resolve.
 */

/** Index, commodity, currency and crypto names the engine maps explicitly. */
export const MAPPED = [
  { id: 'NIFTY50',    label: 'NIFTY 50',        group: 'Indian indices',  exchanges: ['NSE'] },
  { id: 'BANKNIFTY',  label: 'BANK NIFTY',      group: 'Indian indices',  exchanges: ['NSE'] },
  { id: 'FINNIFTY',   label: 'FIN NIFTY',       group: 'Indian indices',  exchanges: ['NSE'] },
  { id: 'MIDCPNIFTY', label: 'MIDCAP NIFTY',    group: 'Indian indices',  exchanges: ['NSE'] },
  { id: 'NIFTYIT',    label: 'NIFTY IT',        group: 'Indian indices',  exchanges: ['NSE'] },
  { id: 'INDIAVIX',   label: 'INDIA VIX',       group: 'Indian indices',  exchanges: ['NSE'] },
  { id: 'SENSEX',     label: 'SENSEX',          group: 'Indian indices',  exchanges: ['BSE'] },

  { id: 'GOLD',       label: 'Gold',            group: 'Commodities',     exchanges: ['NSE', 'BSE', 'NYSE', 'NASDAQ'] },
  { id: 'SILVER',     label: 'Silver',          group: 'Commodities',     exchanges: ['NSE', 'BSE', 'NYSE', 'NASDAQ'] },
  { id: 'CRUDEOIL',   label: 'Crude oil',       group: 'Commodities',     exchanges: ['NSE', 'BSE', 'NYSE', 'NASDAQ'] },
  { id: 'NATURALGAS', label: 'Natural gas',     group: 'Commodities',     exchanges: ['NSE', 'BSE', 'NYSE', 'NASDAQ'] },
  { id: 'COPPER',     label: 'Copper',          group: 'Commodities',     exchanges: ['NSE', 'BSE', 'NYSE', 'NASDAQ'] },
  { id: 'ZINC',       label: 'Zinc',            group: 'Commodities',     exchanges: ['NSE', 'BSE', 'NYSE', 'NASDAQ'] },

  { id: 'SPX',        label: 'S&P 500',         group: 'Global indices',  exchanges: ['NYSE', 'NASDAQ'] },
  { id: 'NDX',        label: 'Nasdaq 100',      group: 'Global indices',  exchanges: ['NASDAQ'] },
  { id: 'DJI',        label: 'Dow Jones',       group: 'Global indices',  exchanges: ['NYSE'] },
  { id: 'VIX',        label: 'VIX',             group: 'Global indices',  exchanges: ['NYSE', 'NASDAQ'] },
  { id: 'NIKKEI',     label: 'Nikkei 225',      group: 'Global indices',  exchanges: ['NYSE', 'NASDAQ'] },
  { id: 'HANGSENG',   label: 'Hang Seng',       group: 'Global indices',  exchanges: ['NYSE', 'NASDAQ'] },
  { id: 'FTSE',       label: 'FTSE 100',        group: 'Global indices',  exchanges: ['NYSE', 'NASDAQ'] },
  { id: 'DAX',        label: 'DAX',             group: 'Global indices',  exchanges: ['NYSE', 'NASDAQ'] },

  { id: 'USDINR',     label: 'USD / INR',       group: 'Currencies',      exchanges: ['NSE', 'BSE'] },
  { id: 'EURUSD',     label: 'EUR / USD',       group: 'Currencies',      exchanges: ['NSE', 'BSE', 'NYSE', 'NASDAQ'] },

  { id: 'BTCUSDT',    label: 'Bitcoin',         group: 'Crypto',          exchanges: ['NSE', 'BSE', 'NYSE', 'NASDAQ'] },
  { id: 'ETHUSDT',    label: 'Ethereum',        group: 'Crypto',          exchanges: ['NSE', 'BSE', 'NYSE', 'NASDAQ'] },
  { id: 'BNBUSDT',    label: 'BNB',             group: 'Crypto',          exchanges: ['NSE', 'BSE', 'NYSE', 'NASDAQ'] },
  { id: 'SOLUSDT',    label: 'Solana',          group: 'Crypto',          exchanges: ['NSE', 'BSE', 'NYSE', 'NASDAQ'] },
  { id: 'XRPUSDT',    label: 'XRP',             group: 'Crypto',          exchanges: ['NSE', 'BSE', 'NYSE', 'NASDAQ'] },
];

/**
 * Large NSE/BSE equities. These are NOT in the engine's explicit map and do not need to be: an
 * unmapped Indian name becomes `<SYMBOL>.NS` or `<SYMBOL>.BO`, which is what Yahoo expects.
 */
export const INDIA_EQUITIES = [
  'RELIANCE', 'TCS', 'HDFCBANK', 'ICICIBANK', 'INFY', 'BHARTIARTL', 'SBIN', 'LT',
  'ITC', 'HINDUNILVR', 'KOTAKBANK', 'AXISBANK', 'BAJFINANCE', 'MARUTI', 'ASIANPAINT',
  'SUNPHARMA', 'TITAN', 'ULTRACEMCO', 'NESTLEIND', 'WIPRO', 'HCLTECH', 'TECHM',
  'ADANIENT', 'ADANIPORTS', 'POWERGRID', 'NTPC', 'ONGC', 'COALINDIA', 'TATAMOTORS',
  'TATASTEEL', 'JSWSTEEL', 'GRASIM', 'CIPLA', 'DRREDDY', 'DIVISLAB', 'EICHERMOT',
  'HEROMOTOCO', 'BAJAJ-AUTO', 'BRITANNIA', 'HINDALCO', 'INDUSINDBK', 'M&M',
  'SHRIRAMFIN', 'SBILIFE', 'HDFCLIFE', 'BAJAJFINSV', 'APOLLOHOSP', 'TATACONSUM',
  'BPCL', 'TRENT',
];

/** Large US names, for the NASDAQ/NYSE selections. Yahoo takes these bare. */
export const US_EQUITIES = [
  'AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA', 'BRK-B', 'AVGO', 'JPM',
  'V', 'MA', 'LLY', 'XOM', 'UNH', 'COST', 'NFLX', 'AMD', 'INTC', 'ORCL',
];

const EQUITY_GROUP = 'Equities';

const US_EXCHANGES = new Set(['NASDAQ', 'NYSE', 'AMEX', 'US']);

/**
 * Collapse an exchange to the three cases the engine actually distinguishes.
 *
 * This MIRRORS `providers.to_yahoo_symbol` on purpose, including its final fallback: an exchange the
 * engine does not recognise gets `.NS`, so an unrecognised exchange here must offer the Indian list.
 * An earlier version returned an almost-empty list instead, which would have told master there is
 * nothing to trade on an exchange the engine would in fact have resolved.
 */
export function normaliseExchange(exchange) {
  const ex = String(exchange || 'NSE').toUpperCase().trim();
  if (US_EXCHANGES.has(ex)) return ex;
  if (ex === 'BSE') return 'BSE';
  return 'NSE';
}

/**
 * The picker's options for one exchange, grouped, with `held` marked.
 *
 * @param {string} exchange one of NSE | BSE | NASDAQ | NYSE
 * @param {Array<{symbol?: string, exchange?: string, interval?: string, bars?: number}>} inventory
 *        whatever `/store/inventory` returned; each entry is one stored series
 * @param {string} current the symbol currently in the field, so it is never missing from its own list
 * @returns {Array<{group: string, items: Array<{id: string, label: string, held: boolean}>}>}
 */
export function optionsFor(exchange, inventory = [], current = '') {
  const ex = normaliseExchange(exchange);
  const isIndia = !US_EXCHANGES.has(ex);
  // The inventory is matched on the RAW value, not the normalised one: a series genuinely stored
  // under an unusual exchange name should still appear when that name is selected.
  const rawEx = String(exchange || 'NSE').toUpperCase().trim();

  // An inventory entry is a stored series, so the same symbol appears once per interval. The set
  // collapses those: master picks a symbol, not a symbol-and-interval.
  const held = new Set();
  for (const row of Array.isArray(inventory) ? inventory : []) {
    const s = String(row?.symbol || '').toUpperCase().trim();
    if (!s) continue;
    const rowEx = String(row?.exchange || '').toUpperCase().trim();
    // A series stored under another exchange is not offered here; showing SENSEX under NASDAQ would
    // make the exchange selector look decorative.
    if (rowEx && rowEx !== rawEx) continue;
    held.add(s);
  }

  const groups = new Map();
  const push = (group, id, label) => {
    const key = String(id || '').toUpperCase().trim();
    if (!key) return;
    if (!groups.has(group)) groups.set(group, new Map());
    const g = groups.get(group);
    if (!g.has(key)) g.set(key, { id: key, label: label || key, held: held.has(key) });
  };

  // Stored series come first and keep their own group, because "what Rāma already has" is the answer
  // to a different question from "what Rāma could fetch".
  for (const s of Array.from(held).sort()) {
    push('Stored locally', s, s);
  }

  for (const m of MAPPED) {
    if (m.exchanges.includes(ex)) push(m.group, m.id, m.label);
  }
  const equities = isIndia ? INDIA_EQUITIES : US_EQUITIES;
  for (const s of equities) push(EQUITY_GROUP, s, s);

  // Master's current symbol must always be selectable, even when it is a name this list has never
  // heard of — otherwise a `<select>` silently shows something he did not choose.
  const cur = String(current || '').toUpperCase().trim();
  if (cur) {
    const seen = Array.from(groups.values()).some((g) => g.has(cur));
    if (!seen) push('Typed', cur, cur);
  }

  return Array.from(groups.entries()).map(([group, items]) => ({
    group,
    items: Array.from(items.values()),
  }));
}

/** A flat, de-duplicated list of every option — for a datalist or a search box. */
export function flatOptionsFor(exchange, inventory = [], current = '') {
  const out = [];
  const seen = new Set();
  for (const g of optionsFor(exchange, inventory, current)) {
    for (const item of g.items) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      out.push(item);
    }
  }
  return out;
}

/** Is this a name the picker knows, or something master typed? Used only to label, never to block. */
export function isKnown(symbol, exchange) {
  const s = String(symbol || '').toUpperCase().trim();
  if (!s) return false;
  return flatOptionsFor(exchange, [], '').some((o) => o.id === s);
}
