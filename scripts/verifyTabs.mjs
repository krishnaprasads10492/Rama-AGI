/**
 * verifyTabs.mjs — the shared tab strip, and the eight bars it replaced (Section 198).
 *
 * WHY THIS SUITE EXISTS AT ALL. The de-duplication is the small part. The real change is that eight
 * hand-written bars had no ARIA and no keyboard support, and one component now carries both — so what
 * needs guarding is not "is there one component" but "does it still behave like a tab strip, and has
 * a ninth copy appeared".
 *
 * The keyboard and normalisation rules live in `tabsModel.js` precisely so they can be CALLED here.
 * A rule inside JSX can only be checked by reading it, and reading is how the wrong tab index ships.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { normaliseItems, nextTabIndex } from '../src/components/tabsModel.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let pass = 0;
let fail = 0;
function check(label, ok, detail) {
  if (ok) { pass += 1; console.log(`  PASS  ${label}`); return; }
  fail += 1;
  console.log(`  FAIL  ${label}${detail ? ` - ${detail}` : ''}`);
}
function eq(label, actual, expected) {
  check(label, JSON.stringify(actual) === JSON.stringify(expected),
    `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}
const section = (t) => console.log(`\n  ${t}`);

console.log('\nRama tabs — one strip, eight pages, and the keyboard none of them had');

// ═══ (1) Both call shapes, because JS has no overloading ═══════════════════
section('items accepts a string or an object, and says the same thing either way');

eq('a plain string becomes id and label',
  normaliseItems(['query']), [{ id: 'query', label: 'query', badge: undefined }]);
eq('an object keeps its id and defaults the label to it',
  normaliseItems([{ id: 'proposals' }]), [{ id: 'proposals', label: 'proposals', badge: undefined }]);
eq('an explicit label wins',
  normaliseItems([{ id: 'ws', label: '◈ WORKSPACE' }]), [{ id: 'ws', label: '◈ WORKSPACE', badge: undefined }]);
eq('the two shapes mix in one list',
  normaliseItems(['a', { id: 'b', badge: 2 }]).map((t) => t.id), ['a', 'b']);
eq('an empty list is empty, not a crash', normaliseItems(undefined), []);

/*
 * REDBY: pass the badge straight through. The hand-written bar in `Evolution` guarded it with
 * `&& length > 0`, so zero pending proposals drew nothing; a naive `badge: item.badge` renders "(0)"
 * on every quiet day. That guard is behaviour, and carrying it over is the difference between
 * consolidating a component and quietly degrading one.
 */
eq('a badge of zero renders nothing rather than "(0)"',
  normaliseItems([{ id: 'p', badge: 0 }])[0].badge, undefined);
eq('a real badge survives', normaliseItems([{ id: 'p', badge: 3 }])[0].badge, 3);

// ═══ (2) The keyboard, which is the part that is new ═══════════════════════
section('arrow keys move along the strip, and wrap');

eq('ArrowRight advances', nextTabIndex('ArrowRight', 0, 4), 1);
eq('ArrowLeft retreats', nextTabIndex('ArrowLeft', 2, 4), 1);
eq('ArrowRight wraps at the end', nextTabIndex('ArrowRight', 3, 4), 0);
eq('ArrowLeft wraps at the start', nextTabIndex('ArrowLeft', 0, 4), 3);
eq('Home jumps to the first', nextTabIndex('Home', 2, 4), 0);
eq('End jumps to the last', nextTabIndex('End', 1, 4), 3);
eq('an unrelated key is not ours', nextTabIndex('a', 1, 4), null);
eq('Enter is not ours either, because selection already follows focus',
  nextTabIndex('Enter', 1, 4), null);
// REDBY: return 0 instead of null for an unknown selection. A bar whose value matches no tab would
// then jump to the first one on any arrow press, moving the user somewhere they did not ask for.
eq('nothing is selected, so nothing moves', nextTabIndex('ArrowRight', -1, 4), null);
eq('an empty strip does not move', nextTabIndex('ArrowRight', 0, 0), null);

// ═══ (3) The component is a tab strip, not a row of buttons ═══════════════
section('the markup is what a screen reader needs');

/*
 * COMMENTS ARE STRIPPED BEFORE ANY OF THIS IS ASSERTED, and the reason is not hypothetical.
 *
 * `Tabs.jsx` has a docblock that NAMES `role="tablist"`, `role="tab"`, `aria-selected` and the
 * roving `tabIndex`, because explaining them is the point of the docblock. Reading the raw file meant
 * every row below could be satisfied by that prose alone — and a mutation that replaced the real
 * `role="tablist"` with `className="tablist"` survived, passing on the strength of a comment
 * describing the attribute it had just removed.
 *
 * Fifth time this project has paid for a pattern that reads documentation as implementation
 * (Sections 145, 183.4, 187.1, 191). Stripped here the same way: replaced with spaces, so nothing
 * shifts position.
 */
const tabsRaw = fs.readFileSync(path.join(ROOT, 'src/components/Tabs.jsx'), 'utf8');
const tabsSrc = tabsRaw
  .replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length))
  .replace(/(^|[^:])(\/\/[^\n]*)/g, (m, pre, c) => pre + ' '.repeat(c.length));
check('the strip is a tablist with a name', /role="tablist"/.test(tabsSrc) && /aria-label=/.test(tabsSrc));
check('each control is a tab', /role="tab"/.test(tabsSrc));
check('and says whether it is the selected one', /aria-selected=\{selected\}/.test(tabsSrc));
/*
 * ROVING TABINDEX, and the reason it is asserted rather than left to taste: `tabIndex={0}` on every
 * tab looks more accessible and is worse. It puts six stops in the tab order where a user expects
 * one, so Tab walks through the bar instead of past it to the panel.
 */
check('exactly one tab is in the tab order', /tabIndex=\{selected \? 0 : -1\}/.test(tabsSrc));
check('the keyboard handler is on the strip, so it works wherever focus is inside it',
  /role="tablist"[\s\S]{0,200}onKeyDown=\{onKeyDown\}/.test(tabsSrc));
check('every control is type="button", so none of them submits a form',
  /type="button"/.test(tabsSrc));
check('the decisions are imported, not re-written inline',
  /from '\.\/tabsModel\.js'/.test(tabsSrc) && !/ArrowRight/.test(tabsSrc));

// REDBY: let the docblock vouch for the markup. This row proves the stripping actually happened, so
// the rows above cannot quietly start reading prose again.
check('the attribute checks read code, not the docblock that explains it',
  /role="tablist"/.test(tabsRaw) && !/explaining them is the point/.test(tabsSrc));

// ═══ (4) No ninth copy ════════════════════════════════════════════════════
section('the pages use it, and nobody has written a ninth bar');

const MIGRATED = [
  'src/pages/Evolution/Evolution.jsx',
  'src/pages/GitSync/GitSync.jsx',
  'src/pages/Intelligence/Intelligence.jsx',
  'src/pages/Models/Models.jsx',
  'src/pages/RamaMind/RamaMind.jsx',
  'src/pages/Resources/Resources.jsx',
  'src/pages/Settings/Settings.jsx',
  'src/pages/System/System.jsx',
];
for (const rel of MIGRATED) {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  check(`${path.basename(rel)} renders <Tabs/>`, /<Tabs\b/.test(src) && /@components\/Tabs\.jsx/.test(src));
}

/*
 * THE RATCHET. REDBY: paste a tab bar into the next page instead of importing this one. The pattern
 * is specific — a map over labels whose button sets the tab — so it does not fire on unrelated
 * buttons, and `StockMind` is excluded by name because its four bars are a deliberate exception.
 */
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.jsx')) out.push(p);
  }
  return out;
}
const HAND_ROLLED = /\.map\(\s*t\s*=>\s*\(?\s*<button key=\{t\} onClick=\{\(\) => set\w+\(t\)\}/;
const offenders = walk(path.join(ROOT, 'src'))
  .filter((f) => !f.includes(`StockMind${path.sep}`))
  .filter((f) => HAND_ROLLED.test(fs.readFileSync(f, 'utf8')))
  .map((f) => path.relative(ROOT, f));
check('no page hand-rolls a tab bar any more', offenders.length === 0, offenders.join(', '));

/*
 * StockMind is the DELIBERATE exception and it is asserted as such, so "we left it alone" cannot
 * quietly become "we forgot". Its four bars use a different visual language — magenta, letter
 * spacing, the selected label in `--text` rather than the accent — and they already carry
 * `role="tab"` and `aria-selected`, which is how the gap in the other eight was noticed at all.
 * Bending this component to cover them would need the variant branching 197.3 refused.
 */
const stockmind = fs.readFileSync(path.join(ROOT, 'src/pages/StockMind/StockMind.jsx'), 'utf8');
check('StockMind keeps its own strips, and they are still accessible on their own terms',
  /role="tab"/.test(stockmind) && /aria-selected=/.test(stockmind));

console.log('\n  held by hand, listed rather than implied:');
console.log('    - no DOM is rendered here. The markup rows read source text, so they prove the');
console.log('      attributes are WRITTEN, not that React emits them — only running the app does');
console.log('    - `aria-controls` is not emitted at all: the pages render panels inline with no');
console.log('      stable ids, and pointing a screen reader at a missing element is worse than');
console.log('      pointing at nothing. Adding it is a per-page change, not a component change');
console.log('    - three bars moved by a few pixels of padding and System lost letter-spacing and');
console.log('      a colour transition. Stated because it is a visual change, however small');

console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'} — ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
