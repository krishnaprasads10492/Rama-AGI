/**
 * type.js — the role NAMES for the type scale. Not a second scale.
 *
 * The renderer is styled almost entirely with inline style objects, which no stylesheet rule can
 * reach. So the numbers live exactly once, in src/index.css's :root block, and this module exports
 * `var()` STRINGS that an inline style can use directly:
 *
 *     <span style={{ fontSize: FS.chrome, lineHeight: LH.chrome }}>
 *
 * A JS-only numeric scale would duplicate every number and drift from index.css and from the
 * .text-* classes; rewriting 813 inline objects into classes is a far larger change than master
 * asked for. Emitting var() strings keeps one number per role (spec 136.7).
 *
 * KEY MAP, css -> js, published so the suite can check parity in both directions:
 *     cssName.replace(/^--(fs|lh)-/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase())
 * so `--fs-dense-lg` is `FS.denseLg`.
 */

/* An unknown role must not throw in a render path, and it must not be silent either. The Proxy
 * returns undefined for an unknown key — React drops an undefined style value, so the site inherits
 * its parent size: degraded, not broken — and warns ONCE per key name, deduped by this Set so a
 * render loop cannot spam the console. Object.freeze installs no read hook, which is why freezing
 * alone could not warn. Proxy is on auditRenderer.cjs's globals allow-list. */
const warned = new Set();

const roleMap = (label, base) => new Proxy(Object.freeze(base), {
  get(target, key) {
    if (key in target) return target[key];
    if (typeof key === 'string' && !warned.has(`${label}.${key}`)) {
      warned.add(`${label}.${key}`);
      console.warn(`[type] unknown ${label} role "${key}" — the site will inherit its parent size`);
    }
    return undefined;
  },
});

/** Font sizes. var() strings only, never numbers — a number here would be a literal in disguise. */
export const FS = roleMap('FS', {
  micro:    'var(--fs-micro)',
  chip:     'var(--fs-chip)',
  dense:    'var(--fs-dense)',
  denseLg:  'var(--fs-dense-lg)',
  chrome:   'var(--fs-chrome)',
  chromeLg: 'var(--fs-chrome-lg)',
  body:     'var(--fs-body)',
  read:     'var(--fs-read)',
  h3:       'var(--fs-h3)',
  h2:       'var(--fs-h2)',
  h1:       'var(--fs-h1)',
  display:  'var(--fs-display)',
});

/** Line heights, same rule. */
export const LH = roleMap('LH', {
  flat:    'var(--lh-flat)',
  chart:   'var(--lh-chart)',
  tight:   'var(--lh-tight)',
  chrome:  'var(--lh-chrome)',
  body:    'var(--lh-body)',
  read:    'var(--lh-read)',
  head:    'var(--lh-head)',
  display: 'var(--lh-display)',
});

/**
 * FLOORS — the minimum px a role may EVER be set to.
 *
 * THIS IS A CONTRACT, NOT A COPY OF THE CURRENT VALUE. index.css may raise a role above its floor
 * without touching this file; what it may not do is drop below it. That is precisely what makes the
 * suite's check an inequality (cssValue >= FLOORS[role]) that can actually fail — an equality would
 * guard nothing. So the apparent duplication is load-bearing: DO NOT "fix" it by deleting FLOORS
 * and reading index.css twice.
 */
export const FLOORS = Object.freeze({
  micro:    11,
  chip:     11.5,
  dense:    12,
  denseLg:  12.5,
  chrome:   13,
  chromeLg: 14,
  body:     15,
  read:     16,
  h3:       17,
  h2:       20,
  h1:       24,
  display:  32,
  chart:    12,
});

/**
 * CHART_FS — the one sanctioned NUMBER in the whole scale, and there is no --fs-chart in CSS.
 * lightweight-charts' `layout.fontSize` option takes a JS number, so no var() string can reach it
 * and a getComputedStyle read at chart construction would be an invented mechanism. It has exactly
 * one consumer, PriceChart.jsx's createChart call, and the suite asserts it equals FLOORS.chart so
 * the chart's size cannot fork from the scale.
 */
export const CHART_FS = 12;
