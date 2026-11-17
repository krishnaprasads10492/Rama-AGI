/**
 * tabsModel.js — the two decisions inside the Tabs component, separated so they can be driven
 * (Section 198).
 *
 * Same split as `healthModel.js` beside `HealthPanel.jsx` (Section 187) and `externalUrl.cjs` beside
 * its handler (196.3): the judgement is a pure function a suite can call with hostile input, and the
 * component is left as markup. A keyboard rule that lives inside JSX can only be checked by reading
 * it, and reading is how the wrong tab index ships.
 */

/**
 * Accept both call shapes and return one.
 *
 * `items={['query', 'result']}` is what seven of the eight bars wanted; the eighth needed a count on
 * one tab. JavaScript has no overloading, so the honest version is a function that normalises — and
 * normalising HERE rather than in the component means the acceptance is testable.
 *
 * A badge of `0` becomes `undefined`: "no pending proposals" should render nothing, not "(0)". That
 * is the one piece of behaviour the old hand-written bar had encoded in a `&& length > 0` guard, and
 * losing it would have been a regression nobody would notice until a quiet day.
 */
export function normaliseItems(items) {
  return (items || []).map((item) => {
    if (item && typeof item === 'object') {
      return {
        id: item.id,
        label: item.label ?? item.id,
        badge: item.badge ? item.badge : undefined,
      };
    }
    return { id: item, label: item, badge: undefined };
  });
}

/**
 * Which tab a key press moves to, or null when the key is not ours.
 *
 * Wrapping is deliberate: ArrowRight on the last tab goes to the first. The WAI-ARIA tabs pattern
 * allows either, and wrapping is what every other tab strip a user has met does.
 *
 * @param {string} key      `event.key`
 * @param {number} current  index of the selected tab, or -1 when nothing matches
 * @param {number} count    how many tabs there are
 * @returns {number|null}
 */
export function nextTabIndex(key, current, count) {
  if (!Number.isInteger(count) || count <= 0) return null;
  if (!Number.isInteger(current) || current < 0) return null;
  if (key === 'ArrowRight') return (current + 1) % count;
  if (key === 'ArrowLeft') return (current - 1 + count) % count;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return null;
}
