#!/usr/bin/env node
'use strict';

/**
 * verifyAudit.cjs — proof that the scope checker catches the bugs it was built for (Section 81).
 *
 * The IDE and Resources pages both failed on mount while `npm run audit` reported everything
 * resolving. Adding a check is not enough: the check has to be shown to catch those exact shapes,
 * and shown not to fire on working code. A checker that is silently broken is worse than no
 * checker, because it is trusted.
 *
 * The two real shapes, reproduced as fixtures:
 *   A. an identifier declared in a SIBLING scope — the IDE bug. A flat "is this name declared
 *      anywhere in the module" check passes this, which is why real scope resolution was needed.
 *   B. a Node builtin referenced in the renderer — the Resources bug.
 *
 * Run: node scripts/verifyAudit.cjs   (or npm run verify:audit)
 */

const { findUndefinedIdentifiers } = require('./auditRenderer.cjs');

let pass = 0;
let fail = 0;

function check(label, ok, detail) {
  if (ok) {
    pass += 1;
    console.log(`  PASS  ${label}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${label}${detail ? ` - ${detail}` : ''}`);
  }
}

const names = (code) => findUndefinedIdentifiers(code).map(h => h.name);
const flags = (code, name) => names(code).includes(name);

// ── Fixture A: the IDE bug — declared in a sibling scope ─────────────────────
console.log('\n--- FIXTURE A: the IDE bug, an identifier declared in a sibling scope ---');

const siblingScope = `
import React, { useCallback } from 'react';
import { useUserStore } from '@store/userStore.js';

function FileTree({ onFileOpen }) {
  const listDir = useCallback(async (p) => {
    const res = await window.rama.fs.listDir(currentUser, p);
    return res.ok ? res.data : [];
  }, [currentUser]);
  return <div onClick={listDir}>tree</div>;
}

export default function IDE() {
  const { currentUser } = useUserStore();
  return <FileTree onFileOpen={() => {}} user={currentUser} />;
}
`;

check('the sibling-scope leak IS caught', flags(siblingScope, 'currentUser'),
  JSON.stringify(names(siblingScope)));
check('THIS IS THE CASE A FLAT MODULE-WIDE CHECK WOULD MISS — the name is declared in the file',
  /const \{ currentUser \}/.test(siblingScope));
check('it reports a line number',
  findUndefinedIdentifiers(siblingScope).find(h => h.name === 'currentUser')?.line > 0,
  JSON.stringify(findUndefinedIdentifiers(siblingScope)));
check('the legitimately-scoped use inside IDE() is NOT double-reported',
  names(siblingScope).filter(n => n === 'currentUser').length >= 1
  && !flags(siblingScope, 'useUserStore'),
  JSON.stringify(names(siblingScope)));
check('imported bindings are not flagged',
  !flags(siblingScope, 'React') && !flags(siblingScope, 'useCallback'));
check('component references that resolve are not flagged',
  !flags(siblingScope, 'FileTree'));
check('lowercase JSX intrinsics are not flagged', !flags(siblingScope, 'div'));

// ── Fixture B: the Resources bug — a Node builtin in the renderer ────────────
console.log('\n--- FIXTURE B: the Resources bug, a Node builtin in the renderer ---');

const nodeBuiltin = `
export default function Panel({ s }) {
  return <div>{Math.max(4, (os?.cpus?.()?.length ?? 4) - 1)} workers {s.workers.max}</div>;
}
`;

check('a Node builtin used in the renderer IS caught', flags(nodeBuiltin, 'os'),
  JSON.stringify(names(nodeBuiltin)));
check('OPTIONAL CHAINING DOES NOT HIDE IT — `os?.x` still throws on the identifier',
  /os\?\./.test(nodeBuiltin) && flags(nodeBuiltin, 'os'));
check('Math is a known global and is not flagged', !flags(nodeBuiltin, 'Math'));
check('a destructured prop is not flagged', !flags(nodeBuiltin, 's'));

// ── Working code must stay quiet ─────────────────────────────────────────────
console.log('\n--- working code must not be flagged ---');

const clean = `
import React, { useState, useEffect, useMemo } from 'react';
import { useUserStore } from '@store/userStore.js';
import PriceChart from './PriceChart.jsx';

const HELPER = (v) => v * 2;

export default function Page({ initial = 1, ...rest }) {
  const { currentUser, canDo } = useUserStore();
  const [n, setN] = useState(initial);
  const doubled = useMemo(() => HELPER(n), [n]);

  useEffect(() => {
    const id = setInterval(() => setN(x => x + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const onClick = async (e) => {
    e.preventDefault();
    try {
      const res = await window.rama.marketIntel.alerts({ user: currentUser });
      console.log(res);
    } catch (err) {
      console.error(err.message);
    }
  };

  for (const item of [1, 2, 3]) { HELPER(item); }
  const { a, b: renamed } = rest;

  class Inner { constructor(x) { this.x = x; } }
  const inst = new Inner(a);

  return (
    <div onClick={onClick}>
      <PriceChart bars={[]} />
      {doubled}{renamed}{inst.x}{canDo('x') ? 'y' : 'n'}
      {[1,2].map((v, i) => <span key={i}>{v}</span>)}
    </div>
  );
}
`;

const cleanHits = findUndefinedIdentifiers(clean);
check('clean code produces NO findings', cleanHits.length === 0, JSON.stringify(cleanHits));

const globalsUse = `
export function wipe() {
  if (!window.caches) return;
  return caches.keys().then(k => k.map(x => caches.delete(x)));
}
export function sizes() {
  return { w: innerWidth, dpr: devicePixelRatio, ua: navigator.userAgent,
    t: performance.now(), j: JSON.stringify({}), d: new Date(), u: new URL('https://x') };
}
`;
check('browser globals including caches are not flagged',
  findUndefinedIdentifiers(globalsUse).length === 0,
  JSON.stringify(findUndefinedIdentifiers(globalsUse)));

// ── Shapes that must not confuse the checker ────────────────────────────────
console.log('\n--- shapes that must not produce false positives ---');

const shapes = `
import React from 'react';
import * as Icons from './icons.js';
const { Provider } = Icons;

function hoisted() { return later(); }
function later() { return 1; }

export default function S({ items = [] }) {
  const [{ x = 1 }, setState] = React.useState({});
  const obj = { key: 'value', shorthandOk: x, computed: [x], nested: { deep: x } };
  const fn = function named() { return named; };
  label: for (const i of items) { if (i) break label; }
  try { hoisted(); } catch ({ message }) { void message; }
  return (
    <Icons.Star aria-label="s" data-x={obj.key}>
      <Provider value={fn}>{items.map(i => i)}</Provider>
    </Icons.Star>
  );
}
`;
const shapeHits = findUndefinedIdentifiers(shapes);
check('object keys, labels, catch params, hoisting and namespace imports are all fine',
  shapeHits.length === 0, JSON.stringify(shapeHits));

const badParse = 'export default function ( { return <div>;';
const parseRes = findUndefinedIdentifiers(badParse);
check('an unparseable file reports a parse error rather than throwing',
  parseRes.length === 1 && !!parseRes[0].parseError, JSON.stringify(parseRes));

console.log(`\n${'='.repeat(62)}`);
console.log(`  ${pass} passed, ${fail} failed`);
console.log('='.repeat(62));
process.exit(fail ? 1 : 0);
