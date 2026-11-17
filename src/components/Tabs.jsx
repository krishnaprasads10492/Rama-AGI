import React, { useCallback, useRef } from 'react';
import { FS, LH } from '@config/type.js';
import { normaliseItems, nextTabIndex } from './tabsModel.js';

/**
 * Tabs — the section switcher seven pages were each writing out by hand (Section 198).
 *
 * WHAT WAS THERE BEFORE. Eight copies of the same `['a','b'].map(t => <button onClick={() => setTab(t)}>)`
 * block, differing only in an accent colour, a few pixels of padding, and one badge. The duplication
 * was mild; the consequence was not. Every copy was a plain `<div>` of `<button>`s with **no ARIA and
 * no keyboard support**, so a tab bar could be reached by Tab and operated by click and nothing else.
 * `StockMind` was the only page that had thought about it, and it was the only one of the eight with
 * `role="tab"` and `aria-selected`.
 *
 * So this is not a de-duplication that happens to be accessible. It is an accessibility fix that was
 * only affordable *because* the thing became one component: adding roving focus and arrow keys to
 * eight hand-written bars is eight chances to get it wrong, and doing it once is one.
 *
 * WHAT IT IMPLEMENTS, to the WAI-ARIA tabs pattern:
 *   - `role="tablist"` on the strip, `role="tab"` and `aria-selected` on each control
 *   - ROVING TABINDEX: exactly one tab is in the tab order, so Tab moves past the bar rather than
 *     through every tab in it — which is the behaviour a keyboard user expects and the reason a
 *     `tabIndex={0}` on every button is wrong even though it looks more accessible
 *   - ArrowLeft / ArrowRight to move, with wrap; Home and End to jump
 *   - `aria-controls` and per-tab ids, but ONLY when an `id` is supplied (Section 199). 198.4 left
 *     them out because the panels had no ids to point at, and a reference to a missing element is
 *     worse for a screen reader than silence. `TabPanel` now supplies the target; a caller that
 *     renders its own panel and passes no `id` still gets a correct strip rather than a dangling
 *     reference.
 *
 * ON "OVERLOADING", which Section 197.0 answered for the main process and applies here too: JS has
 * none, so `items` accepts either shape and normalises —
 *
 *     items={['query', 'result']}                      // label is the id
 *     items={[{ id: 'proposals', label: 'proposals', badge: 3 }]}
 *
 * That is one function serving two call shapes, which is the honest equivalent, and it keeps the
 * seven call sites as short as the lines they replace.
 *
 * The accent is a prop rather than a variant: three pages use `--accent`, `GitSync` uses `--amber`
 * and `RamaMind`/`Evolution` use `--violet`, and a colour is data. `StockMind`'s four bars are NOT
 * migrated — they use a different visual language entirely (magenta, letter-spacing, the selected
 * label in `--text` rather than the accent), and bending this component to cover them would mean the
 * variant branching Section 197.3 refused.
 */

export default function Tabs({
  items,
  value,
  onChange,
  accent = 'accent',
  label = 'Sections',
  id,
  style,
}) {
  const tabs = normaliseItems(items);
  const refs = useRef([]);

  /*
   * Arrow keys move focus AND selection together. For a tab list whose panels are rendered inline —
   * which is every page here — that is the "automatic activation" pattern, and it is the right one:
   * the alternative requires Enter to confirm, which means a keyboard user arrowing along the bar
   * sees nothing change and has no way to know why.
   */
  const onKeyDown = useCallback((e) => {
    const next = nextTabIndex(e.key, tabs.findIndex((t) => t.id === value), tabs.length);
    if (next === null) return;
    e.preventDefault();
    onChange?.(tabs[next].id);
    // Focus follows selection, or the next arrow press would move from where focus still was.
    refs.current[next]?.focus();
  }, [tabs, value, onChange]);

  return (
    <div
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      style={{
        display: 'flex',
        borderBottom: '1px solid var(--border)',
        background: 'var(--surface)',
        flexShrink: 0,
        ...style,
      }}
    >
      {tabs.map((t, i) => {
        const selected = value === t.id;
        return (
          <button
            key={t.id}
            ref={(el) => { refs.current[i] = el; }}
            type="button"
            role="tab"
            aria-selected={selected}
            /*
             * EMITTED ONLY WHEN THERE IS AN `id`, because `aria-controls` pointing at an element
             * that does not exist is worse than silence — a screen reader promises a panel and then
             * cannot reach it. 198.4 left this out for exactly that reason; `TabPanel` now supplies
             * the target, and a caller that renders its own panel without one still gets a correct
             * strip rather than a broken reference.
             */
            id={id ? `${id}-tab-${t.id}` : undefined}
            aria-controls={id ? `${id}-panel` : undefined}
            // ROVING TABINDEX — see the docblock. Only the selected tab is reachable by Tab.
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange?.(t.id)}
            style={{
              padding: '9px 18px',
              border: 'none',
              background: 'transparent',
              color: selected ? `var(--${accent})` : 'var(--muted)',
              borderBottom: selected ? `2px solid var(--${accent})` : '2px solid transparent',
              cursor: 'pointer',
              fontFamily: 'var(--font)',
              fontSize: FS.chrome,
              lineHeight: LH.chrome,
              textTransform: 'uppercase',
            }}
          >
            {t.label}
            {t.badge ? (
              <span style={{
                marginLeft: 4,
                fontSize: FS.chrome,
                lineHeight: LH.chrome,
                color: 'var(--amber)',
              }}>
                ({t.badge})
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
