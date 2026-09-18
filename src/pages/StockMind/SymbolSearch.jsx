import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { localSearch } from './symbols.js';

/**
 * SymbolSearch — a select dropdown over every market (spec Sections 102, 103).
 *
 * WHAT THIS IS, AFTER TWO CORRECTIONS FROM MASTER.
 *
 * First: *"it is not possible to know every stock/index name in every market but you implemented text
 * field with no search."* Correct — a curated list of fifty names beside a raw text box is a text box
 * with decoration, and it cannot answer "what is Reliance Power called".
 *
 * Then: *"instead of searchbox give me a select dropdown."* Also correct, and it is a different point.
 * What I built was an `<input>`: closed, it looked like an empty text field, so it still demanded that
 * master already know what to type before anything appeared. A dropdown asks nothing of him — it shows
 * the current choice, and clicking it reveals what is on offer.
 *
 * So the CLOSED state is a dropdown: a button showing the selected instrument and a caret, styled as
 * the form's other selects. The OPEN state lists everything grouped, and carries a filter field at the
 * top of the panel. The filter is what keeps the first correction satisfied — a native `<select>`
 * genuinely cannot hold every instrument in every market, so the reach has to live inside the panel
 * rather than replace it. Nothing was removed (I11): browse if you do not know the name, type if you
 * do.
 *
 * TWO SOURCES, AND THE DIFFERENCE IS VISIBLE.
 *
 *   provider — `market:symbol-search`, which asks Yahoo and returns every market it knows. This is
 *              what makes "every stock/index in every market" true rather than aspirational.
 *   offline  — `symbols.localSearch`, the curated list. Used when the engine cannot answer, which on
 *              master's machine is the current state, so this is not a theoretical branch.
 *
 * A PROVIDER FAILURE IS NOT "NO RESULTS". The engine route returns `ok:false` with a reason when it
 * could not ask, distinct from `results: []` when nothing matched. Collapsing the two would show
 * master "no such symbol" for a network problem — sending him to fix his spelling when the fault is
 * elsewhere. So a failure falls back to the offline list AND says it did.
 *
 * FREE TEXT IS NEVER TAKEN AWAY (I11). Enter commits whatever is typed. A picker that cannot express
 * a name master knows and it does not would be a downgrade from the text box it replaced, and the
 * provider is not omniscient either.
 *
 * ARIA COMBOBOX, not a div with a click handler. `role="combobox"` with `aria-expanded`,
 * `aria-controls`, `aria-activedescendant` and a `role="listbox"` of `role="option"` — which is also
 * what makes arrow keys, Enter and Escape work, because implementing the pattern properly is the
 * same work as making it keyboard-usable.
 */

const DEBOUNCE_MS = 220;

// Below this, a provider search is noise: one character matches thousands of instruments and the
// list would reshuffle on every keystroke. The offline list still filters from the first character,
// because it is small enough to be useful immediately.
const MIN_REMOTE_CHARS = 2;

const KIND_COLOR = {
  Index: 'var(--accent)', Stock: 'var(--text)', ETF: 'var(--green)',
  Fund: 'var(--green)', Crypto: 'var(--magenta, var(--accent))',
  Currency: 'var(--amber)', Future: 'var(--amber)',
};

export default function SymbolSearch({
  value = '',
  exchange = 'NSE',
  inventory = [],
  onPick,                      // ({ symbol, exchange }) => void
  disabled = false,
  placeholder = 'search any stock, index, ETF, crypto…',
  id = 'symbol-search',
  ariaLabel = 'Search for an instrument',
  autoFocus = false,
}) {
  const [text, setText] = useState(value || '');
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState([]);
  const [active, setActive] = useState(-1);
  const [busy, setBusy] = useState(false);
  const [source, setSource] = useState(null);      // 'provider' | 'offline' | null
  const [note, setNote] = useState(null);

  const boxRef = useRef(null);
  const inputRef = useRef(null);
  const triggerRef = useRef(null);
  const listRef = useRef(null);
  const timerRef = useRef(null);
  // Monotonic request id. Without it a slow answer for "rel" can land after a fast answer for
  // "relian" and repopulate the list with results for text master has already replaced.
  const seqRef = useRef(0);

  // The field follows the committed value when it changes elsewhere — picking a symbol from the book
  // table, for instance — but not while master is mid-search, which would erase what he is typing.
  useEffect(() => {
    if (!open) setText(value || '');
  }, [value, open]);

  const offline = useCallback((q) => localSearch(q, exchange, inventory, 12)
    .map((r) => ({
      symbol: r.id, exchange, name: r.label === r.id ? '' : r.label,
      kind: r.group === 'Stored locally' ? 'Stored' : '', held: r.held,
      exchangeName: exchange, origin: 'offline',
    })), [exchange, inventory]);

  const search = useCallback(async (q) => {
    const seq = ++seqRef.current;
    const local = offline(q);

    const bridge = typeof window !== 'undefined' && window.rama?.marketIntel?.symbolSearch;
    if (!bridge || q.trim().length < MIN_REMOTE_CHARS) {
      if (seq !== seqRef.current) return;
      setRows(local);
      setSource('offline');
      setNote(bridge ? null : 'Offline list — the desktop bridge is unavailable.');
      return;
    }

    setBusy(true);
    let res = null;
    try {
      res = await window.rama.marketIntel.symbolSearch({ query: q, limit: 12 });
    } catch {
      res = null;
    }
    if (seq !== seqRef.current) return;             // a newer keystroke already won
    setBusy(false);

    const payload = res?.ok === false ? null : res?.data;
    const usable = payload?.ok !== false && Array.isArray(payload?.results);

    if (!usable) {
      setRows(local);
      setSource('offline');
      // The reason matters: "the engine is not running" is a different instruction from "no such
      // symbol", and the previous design could not tell master which he was looking at.
      setNote(local.length > 0
        ? 'Showing Rāma\'s own list — the engine could not be asked.'
        : 'The engine could not be asked, and the offline list has no match. Type the exact '
          + 'ticker and press Enter.');
      return;
    }

    const remote = payload.results.map((r) => ({ ...r, origin: 'provider' }));
    // Stored series are merged in ahead of the provider's answers: those need no network call, and
    // the provider does not know which ones Rāma already holds.
    const heldMatches = local.filter((l) => l.held
      && !remote.some((r) => r.symbol === l.symbol && r.exchange === l.exchange));
    setRows(heldMatches.concat(remote));
    setSource('provider');
    setNote(remote.length === 0 ? 'No instrument matches that.' : null);
  }, [offline]);

  const onChange = (e) => {
    const next = e.target.value;
    setText(next);
    setOpen(true);
    setActive(-1);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => search(next), DEBOUNCE_MS);
  };

  // Opening from the trigger clears the filter and lists everything: master pressed a dropdown, so he
  // is browsing. Carrying the previous filter forward would show him a narrowed list he did not ask
  // for and could not see the cause of.
  const openPanel = () => {
    setOpen(true);
    setActive(-1);
    setText('');
    search('');
    // The filter, not the trigger, takes focus — otherwise arrow keys would move the page.
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const closePanel = (refocus = true) => {
    setOpen(false);
    setActive(-1);
    setText(value || '');
    if (refocus) triggerRef.current?.focus();
  };

  const openWith = () => {
    setOpen(true);
    setActive(-1);
    if (rows.length === 0) search(text);
  };

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  // Clicking away closes the list. A listbox that stays open over the rest of the form is worse than
  // no listbox, because it hides the fields master is trying to reach next.
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) closePanel(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  // Keep the highlighted option in view when arrowing through a list longer than the panel.
  useEffect(() => {
    if (active < 0 || !listRef.current) return;
    const el = listRef.current.querySelector(`[data-idx="${active}"]`);
    if (el?.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const commit = (row) => {
    setOpen(false);
    setActive(-1);
    setText(row.symbol);
    onPick?.({ symbol: row.symbol, exchange: row.exchange || exchange, name: row.name || '' });
    triggerRef.current?.focus();
  };

  const commitTyped = () => {
    const typed = String(text || '').trim().toUpperCase();
    setOpen(false);
    setActive(-1);
    if (typed) onPick?.({ symbol: typed, exchange, name: '' });
    triggerRef.current?.focus();
  };

  // The closed dropdown. Enter, Space and Down all open it, which is what a `<select>` does.
  const onTriggerKeyDown = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      openPanel();
    }
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) { openWith(); return; }
      setActive((i) => (rows.length === 0 ? -1 : (i + 1) % rows.length));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) return;
      setActive((i) => (rows.length === 0 ? -1 : (i <= 0 ? rows.length - 1 : i - 1)));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (open && active >= 0 && rows[active]) commit(rows[active]);
      else commitTyped();
      return;
    }
    if (e.key === 'Escape') {
      if (open) { e.preventDefault(); closePanel(); }
      return;
    }
    if (e.key === 'Tab' && open) setOpen(false);
  };

  const listId = `${id}-listbox`;
  const activeId = active >= 0 ? `${id}-opt-${active}` : undefined;

  const hint = useMemo(() => {
    if (busy) return 'searching…';
    if (note) return note;
    if (source === 'provider') return `${rows.length} from the provider · Enter to use what you typed`;
    if (source === 'offline' && rows.length > 0) return 'Rāma\'s own list · Enter to use what you typed';
    return null;
  }, [busy, note, source, rows.length]);

  const selectedName = useMemo(() => {
    const cur = String(value || '').toUpperCase();
    const hit = rows.find((r) => r.symbol === cur);
    return hit?.name || '';
  }, [rows, value]);

  return (
    <div ref={boxRef} style={{ position: 'relative' }}>
      {/* THE CLOSED CONTROL IS A DROPDOWN, not a text field. It shows what is selected and a caret, so
          master never has to know a name before the control will show him anything. */}
      <button
        ref={triggerRef}
        id={id}
        type="button"
        className="input"
        disabled={disabled}
        autoFocus={autoFocus}
        onClick={() => (open ? closePanel() : openPanel())}
        onKeyDown={onTriggerKeyDown}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        style={{
          display: 'flex', alignItems: 'center', gap: '8px', width: '100%',
          textAlign: 'left', cursor: disabled ? 'default' : 'pointer',
        }}
      >
        <span style={{ color: value ? 'var(--text)' : 'var(--muted)', fontWeight: value ? 600 : 400 }}>
          {value || 'choose an instrument'}
        </span>
        {selectedName && (
          <span style={{ color: 'var(--muted)', flex: 1, overflow: 'hidden',
            textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '12px' }}>
            {selectedName}
          </span>
        )}
        <span aria-hidden="true" style={{ marginLeft: 'auto', color: 'var(--muted)' }}>▾</span>
      </button>

      {open && (
        <div
          id={listId}
          ref={listRef}
          role="listbox"
          aria-label="Matching instruments"
          style={{
            position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 60, marginTop: '3px',
            maxHeight: '280px', overflowY: 'auto',
            background: 'var(--panel, #131722)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius, 6px)', boxShadow: '0 10px 28px rgba(0,0,0,0.5)',
          }}
        >
          {/* The filter lives INSIDE the panel. A native select cannot hold every instrument in every
              market, so the reach has to be here rather than instead of the dropdown. */}
          <div style={{ padding: '6px', borderBottom: '1px solid var(--border)',
            position: 'sticky', top: 0, background: 'var(--panel, #131722)', zIndex: 1 }}>
            <input
              ref={inputRef}
              className="input"
              value={text}
              onChange={onChange}
              onKeyDown={onKeyDown}
              placeholder={placeholder}
              aria-label="Filter the list, or search any market"
              aria-controls={listId}
              aria-activedescendant={activeId}
              aria-autocomplete="list"
              autoComplete="off"
              spellCheck="false"
              style={{ width: '100%' }}
            />
          </div>
          {rows.length === 0 && (
            <div style={{ padding: '10px 12px', fontSize: '12.5px', color: 'var(--muted)',
              lineHeight: 1.6 }}>
              {busy ? 'Searching…' : (note || 'Keep typing, or press Enter to use what you typed.')}
            </div>
          )}
          {rows.map((r, i) => (
            // eslint-disable-next-line jsx-a11y/click-events-have-key-events
            <div
              key={`${r.exchange}:${r.symbol}:${i}`}
              id={`${id}-opt-${i}`}
              data-idx={i}
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => { e.preventDefault(); commit(r); }}
              style={{
                display: 'flex', alignItems: 'baseline', gap: '8px', padding: '6px 10px',
                cursor: 'pointer', fontSize: '12.5px',
                background: i === active
                  ? 'color-mix(in srgb, var(--accent) 16%, transparent)' : 'transparent',
                borderBottom: '1px solid var(--border)',
              }}
            >
              <strong style={{ color: 'var(--text)', minWidth: '84px', fontVariantNumeric: 'tabular-nums' }}>
                {r.held ? '● ' : ''}{r.symbol}
              </strong>
              <span style={{ color: 'var(--text-dim, var(--muted))', flex: 1, overflow: 'hidden',
                textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {r.name || '—'}
              </span>
              {r.kind && (
                <span style={{ fontSize: '12px', color: KIND_COLOR[r.kind] || 'var(--muted)' }}>
                  {r.kind}
                </span>
              )}
              <span style={{ fontSize: '12px', color: 'var(--muted)', minWidth: '52px',
                textAlign: 'right' }}>
                {r.exchangeName || r.exchange}
              </span>
            </div>
          ))}
          {hint && (
            <div style={{ padding: '6px 10px', fontSize: '12px', color: 'var(--muted)',
              lineHeight: 1.5 }} aria-live="polite">
              {hint}
              {source === 'provider' && (
                <span style={{ display: 'block' }}>● already stored — draws with no network call</span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
