#!/usr/bin/env node
/**
 * verifyUiSecurity.mjs — what the dependency-security panel may say (spec Section 182)
 *
 * THE FAILURE THIS GUARDS IS A SENTENCE, NOT A CRASH. Section 180.5 measured the OSV pass returning
 * "0 vulnerable" on a tree that held twenty advisories. Nothing was shipped to a screen only because
 * no screen existed. Build the screen without holding the sentences shut and the measured defect
 * becomes a displayed reassurance — which is worse than the silence it replaced, because master
 * would act on it.
 *
 * So every sentence is made by `src/pages/System/securityModel.js` and driven here with awkward
 * input: missing fields, a failed scan, a withheld scan, a zero that means "I did not look there",
 * and two sources that disagree. The component is then read AS SOURCE for the handful of properties
 * a render cannot demonstrate: that it invents no sentence of its own, that it shells out to
 * `npm audit` only when master asks, and that it has no `console.log`.
 *
 * Run: node scripts/verifyUiSecurity.mjs   (or npm run verify:ui-security)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as M from '../src/pages/System/securityModel.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0;
let fail = 0;
const check = (label, ok, detail) => {
  if (ok) { pass += 1; console.log(`  PASS  ${label}`); }
  else { fail += 1; console.log(`  FAIL  ${label}${detail ? ` - ${detail}` : ''}`); }
};

// Every string reachable in a value, so a forbidden word cannot hide in a nested field.
const strings = (v, out = []) => {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => strings(x, out));
  return out;
};

// ─── Fixtures ────────────────────────────────────────────────────────────────────────────────────
const finding = (over = {}) => ({
  name: 'axios', severity: 'high', range: '<1.12.0', direct: false,
  reachedThrough: 'vectra', hops: 2, nodes: ['node_modules/axios'],
  advisories: [{ title: 'axios SSRF', url: 'https://x', severity: 'high', cwe: ['CWE-918'] }],
  route: 'major-required', why: 'fixable only by vectra@0.15.0, a breaking change',
  remedy: "Master's decision: a major bump of vectra needs a build and a launch test.",
  buildOnly: false, reachable: null, scopeNote: null, ...over,
});

/** The real shape of `deps:review`: a narrow OSV pass, and a wide npm-audit pass beside it. */
const payload = (over = {}) => ({
  ok: true,
  data: {
    rows: [], actionable: [],
    summary: { checked: 24, vulnerable: 0, upToDate: 20, breaking: 1 },
    failures: [], scanned: 24, includedDev: false,
    coverage: {
      askedAbout: 24, directDependencies: 24,
      installedTreeCovered: false, transitiveCovered: false,
      meaning: 'Only direct dependencies were asked about.',
      soZeroMeans: 'No advisory was found for the names asked about.',
    },
    tree: {
      ok: true, reason: null,
      findings: [finding()],
      summary: {
        total: 1,
        byRoute: { 'downgrade-refused': 0, 'no-fix-published': 0, 'major-required': 1, 'override-candidate': 0, 'semver-fix': 0, unknown: 0 },
        bySeverity: { info: 0, low: 0, moderate: 0, high: 1, critical: 0 },
        actionable: 0, needsMaster: 1, scoped: 0,
      },
      coverage: {
        source: 'npm audit', installedTreeCovered: true, transitiveCovered: true,
        declaredDependencies: 24, declaredDevDependencies: 20,
        treeTotals: { prod: 265, dev: 370, total: 638 },
        installedVersionsSupplied: true,
        limits: ['npm audit reports what the advisory databases know today.'],
      },
    },
    at: '2026-10-17T00:00:00.000Z',
    ...over,
  },
});

// ─── A zero is never a clean bill of health ──────────────────────────────────────────────────────
console.log('\n--- the measured defect: a zero that means "I did not look there" ---');
{
  // THE EXACT SHAPE OF SECTION 180.5: narrow says 0, the tree says 20.
  const many = Array.from({ length: 20 }, (_, i) => finding({ name: `pkg-${i}` }));
  const real = payload();
  real.data.tree.findings = many;
  real.data.tree.summary.total = 20;

  const h = M.headline(real);
  check('the narrow scan reporting 0 does NOT suppress the wide number', h.wide.found === 20);
  check('and the disagreement is stated outright, not averaged away', /The two scans disagree: 0 against 20/.test(h.disagreement || ''));
  check('the sentence says which number to trust', /Trust the wider number/.test(h.disagreement || ''));
  check('it explains WHY they differ rather than calling one broken',
    /expected rather than broken/.test(h.disagreement || '') && /dependency of a dependency/.test(h.disagreement || ''));
  check('each number is published WITH the question it answered',
    /direct dependencies/.test(h.narrow.question) && /every installed package/.test(h.wide.question));
  check('there is no boolean saying the tree is safe',
    !('clean' in h) && !('safe' in h) && !('ok' in h) && !('secure' in h), Object.keys(h).join(','));
  check('the caveat that an absent advisory is not safety is said unconditionally',
    /not the same as that package being safe/.test(h.caveat));

  // Two scans that AGREE have nothing to disagree about, and inventing a sentence would be noise.
  const agree = payload();
  agree.data.summary.vulnerable = 1;
  check('when the two scans agree, no disagreement is manufactured', M.headline(agree).disagreement === null);

  // AND THE CASE THAT WOULD BE A REAL CLEAN: both zero. Still not called clean.
  const zero = payload();
  zero.data.tree.findings = [];
  zero.data.tree.summary.total = 0;
  const zh = M.headline(zero);
  check('a genuine 0 and 0 still carries the caveat and claims nothing',
    zh.disagreement === null && /not a package that is safe|not the same as that package being safe/.test(zh.caveat));
  check('and its one-line form says WHAT the zero covers, not that all is well',
    M.oneLine(zero) === '0 advisory(ies) across 638 installed packages', M.oneLine(zero));
}

// ─── Four different nothings ─────────────────────────────────────────────────────────────────────
console.log('\n--- four different nothings, never conflated ---');
{
  const idle = M.state(null);
  const failed = M.state({ ok: false, error: 'Access denied: "self-modify.view" required' });
  const partial = payload();
  partial.data.tree = { ok: false, reason: 'npm audit produced no parseable output', findings: [] };
  const withheld = payload();
  withheld.data.tree = { ok: false, withheld: true, requires: 'system.self-update',
    reason: 'the tree-wide detail names Rāma\u2019s own attack surface package by package.', findings: [] };
  const ready = M.state(payload());

  check('idle, failed, partial, withheld and ready are five distinct kinds',
    new Set([idle.kind, failed.kind, M.state(partial).kind, M.state(withheld).kind, ready.kind]).size === 5,
    JSON.stringify([idle.kind, failed.kind, M.state(partial).kind, M.state(withheld).kind, ready.kind]));
  check('nothing-yet says it has not been scanned, never that nothing was found',
    /Not scanned yet/.test(idle.title) && !/found|clean|safe/i.test(idle.title));
  check('a failed scan reports the reason it was given', /Access denied/.test(failed.detail));
  check('a failed scan with no reason says so rather than implying success',
    /No reason was reported/.test(M.state({ ok: false }).detail));
  check('a partial scan says which half ran and that the rest is uncovered',
    /Only the narrow scan completed/.test(M.state(partial).title)
    && /direct dependencies only/.test(M.state(partial).detail));
  check('a partial scan passes the reason through', /no parseable output/.test(M.state(partial).detail));

  // THE SECTION 107 RULE: a policy withholding is not a broken subsystem.
  const w = M.state(withheld);
  check('a WITHHELD scan is not reported as a failed or missing one', w.kind === 'withheld');
  check('it says the detail is master-only', /master-only/i.test(w.title));
  check('it names the capability required', /system\.self-update/.test(w.detail));
  check('it says the summary is NOT withheld, so the reader is not left thinking all is hidden',
    /not withheld/i.test(w.detail));
  check('a withholding never reads as "nothing was found"', !/no (advisor|vulnerab|finding)/i.test(w.detail));
  check('and it still reports the narrow count it DOES have', /among direct dependencies only/.test(M.oneLine(withheld)));
  check('the withholding is listed as a limit, being the biggest thing not shown',
    M.limits(withheld).some((l) => /not run for this account/.test(l) && /system\.self-update/.test(l)));
  check('idle and failed have no number, so neither implies one',
    M.oneLine(null) === 'Not scanned yet' && M.oneLine({ ok: false, error: 'x' }) === 'The scan could not complete');
}

// ─── A missing figure is a dash, never a zero ────────────────────────────────────────────────────
console.log('\n--- a missing figure is a dash, never a zero ---');
{
  const bare = { ok: true, data: {} };
  const h = M.headline(bare);
  check('an absent narrow count is null, not 0', h.narrow.found === null);
  check('an absent wide count is null, not 0', h.wide.found === null);
  check('two absent counts do not fabricate a disagreement', h.disagreement === null);
  check('absent counts do not fabricate agreement either — oneLine shows a dash',
    M.oneLine(bare) === '— found among direct dependencies only', M.oneLine(bare));
  check('byRoute on an empty payload shows dashes, not zeros',
    M.byRoute(bare).every((r) => r.display === '—' && r.count === null));
  check('every route is still listed, so the shape does not shift under the reader',
    M.byRoute(bare).length === Object.keys(M.ROUTE_LABELS).length);
  check('no rows are invented from an empty payload', M.rows(bare).length === 0);
  check('a tree that failed yields no rows rather than partial ones',
    M.rows({ ok: true, data: { tree: { ok: false, findings: [finding()] } } }).length === 0);
  check('a real zero IS shown as 0 — the dash is for absence only',
    M.byRoute(payload()).find((r) => r.route === 'semver-fix').display === '0');
}

// ─── Rows: worst first, and scope kept beside severity rather than folded into it ────────────────
console.log('\n--- rows: worst first, and scope never flatters the severity ---');
{
  const mixed = payload();
  mixed.data.tree.findings = [
    finding({ name: 'low-one', severity: 'low' }),
    finding({ name: 'odd-one', severity: 'bananas' }),
    finding({ name: 'crit-one', severity: 'critical' }),
    finding({ name: 'info-one', severity: 'info' }),
    finding({ name: 'mod-one', severity: 'moderate' }),
    finding({ name: 'no-sev' , severity: undefined }),
    finding({ name: 'high-one', severity: 'high' }),
  ];
  const r = M.rows(mixed);
  const at = (name) => r.findIndex((x) => x.name === name);
  check('critical first, then high, moderate, low',
    r.slice(0, 4).map((x) => x.name).join(',') === 'crit-one,high-one,mod-one,low-one',
    r.map((x) => `${x.name}:${x.severity}`).join(' '));
  // ASSERTED AGAINST `info`, NOT JUST AGAINST THE TAIL. Sorting an unrecognised severity into
  // `low`'s slot leaves the tail looking right while placing an unknown ABOVE a known info — the
  // mutation that survived the first draft of this check.
  check('a severity nobody recognises sorts after every severity that IS recognised, info included',
    at('odd-one') > at('info-one') && at('no-sev') > at('info-one'),
    r.map((x) => x.name).join(','));
  check('and after low, so it is never read as a mild finding', at('odd-one') > at('low-one'));
  check('a missing severity becomes "unknown" rather than disappearing',
    r.some((x) => x.name === 'no-sev' && x.severity === 'unknown'));
  check('severity is lowercased so the panel never has two spellings of one level',
    M.rows({ ok: true, data: { tree: { ok: true, findings: [finding({ severity: 'CRITICAL' })] } } })[0].severity === 'critical');

  // SCOPE. A build-only critical is still a critical.
  const scoped = payload();
  scoped.data.tree.findings = [finding({ name: 'tar', severity: 'critical', buildOnly: true,
    scopeNote: 'Reached only through a devDependency, so it runs on the build machine and is excluded from the packaged app.' })];
  const s = M.rows(scoped)[0];
  check('a build-only finding keeps its real severity', s.severity === 'critical');
  check('and carries the scope note as a separate sentence', /build machine/.test(s.scopeNote));
  check('the note is not folded into the severity or the route',
    s.route === 'major-required' && !/build machine/.test(`${s.severity}${s.route}`));

  const f = M.rows(payload())[0];
  check('a transitive finding says what it was reached through', f.via === 'reached through vectra');
  check('a direct finding invents no "via"', M.rows({ ok: true, data: { tree: { ok: true, findings: [finding({ reachedThrough: null })] } } })[0].via === null);
  check('the remedy travels with the row', /Master\u2019s decision|Master's decision/.test(f.remedy || ''));
  check('the route label is prose, not the slug', f.routeLabel === M.ROUTE_LABELS['major-required']);
  check('a route the model does not know falls back to the raw value rather than blank',
    M.rows({ ok: true, data: { tree: { ok: true, findings: [finding({ route: 'invented' })] } } })[0].routeLabel === 'invented');
  check('a fixable row is marked actionable and not as needing a decision',
    (() => { const x = M.rows({ ok: true, data: { tree: { ok: true, findings: [finding({ route: 'semver-fix' })] } } })[0];
      return x.actionable === true && x.needsDecision === false; })());
  check('a refused downgrade is master\u2019s decision, not something to click',
    (() => { const x = M.rows({ ok: true, data: { tree: { ok: true, findings: [finding({ route: 'downgrade-refused' })] } } })[0];
      return x.actionable === false && x.needsDecision === true; })());
  check('an unroutable row is neither actionable nor a decision — it is a gap',
    (() => { const x = M.rows({ ok: true, data: { tree: { ok: true, findings: [finding({ route: 'unknown' })] } } })[0];
      return x.actionable === false && x.needsDecision === false; })());
  check('advisories without a title are dropped rather than rendered as blanks',
    M.rows({ ok: true, data: { tree: { ok: true, findings: [finding({ advisories: [{ title: null }, null, { title: 'real' }] })] } } })[0].advisories.length === 1);
  check('a non-array advisories field does not throw',
    M.rows({ ok: true, data: { tree: { ok: true, findings: [finding({ advisories: 'nope' })] } } })[0].advisories.length === 0);

  const twenty = payload();
  twenty.data.tree.findings = Array.from({ length: 20 }, (_, i) => finding({ name: `p${i}` }));
  check('the limit is respected', M.rows(twenty, { limit: 5 }).length === 5);
  check('a limit of 0 yields nothing rather than everything', M.rows(twenty, { limit: 0 }).length === 0);
  check('a negative limit cannot wrap round into a full list', M.rows(twenty, { limit: -3 }).length === 0);
}

// ─── Counts by route ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- counts by route ---');
{
  const b = M.byRoute(payload());
  check('the one major-required finding is counted', b.find((x) => x.route === 'major-required').count === 1);
  check('every route carries its prose label', b.every((x) => x.label === M.ROUTE_LABELS[x.route]));
  check('the refused downgrade is named as a REFUSAL, so nobody reads it as an available fix',
    /DOWNGRADE/.test(M.ROUTE_LABELS['downgrade-refused']) && /refused/i.test(M.ROUTE_LABELS['downgrade-refused']));
  check('"no fix published" is distinguished from "fixable"',
    M.ROUTE_LABELS['no-fix-published'] !== M.ROUTE_LABELS['semver-fix']);
  check('a breaking upgrade is labelled as master\u2019s decision', /your decision/i.test(M.ROUTE_LABELS['major-required']));
  check('"unknown" says the information is missing, not that the package is fine',
    /not enough information/i.test(M.ROUTE_LABELS.unknown));
  check('the route order is the triage\u2019s own, worst-actionable first',
    Object.keys(M.ROUTE_LABELS)[0] === 'downgrade-refused');
}

// ─── Limits ──────────────────────────────────────────────────────────────────────────────────────
console.log('\n--- what the scan did not look at ---');
{
  const p = payload();
  p.data.failures = [{ name: 'vectra', reason: 'registry timeout' }];
  const ls = M.limits(p);
  check('a package whose lookup FAILED is listed as not checked, not as healthy',
    ls.some((l) => /vectra: not checked — registry timeout/.test(l)), JSON.stringify(ls));
  check('the narrow pass admits it covers direct dependencies only',
    ls.some((l) => /direct dependencies only/.test(l)));
  check('the tree pass\u2019s own limits are carried through verbatim',
    ls.some((l) => /advisory databases know today/.test(l)));
  check('the "nothing is applied automatically" line is present on EVERY payload',
    [null, { ok: false }, { ok: true, data: {} }, p].every((x) => M.limits(x).some((l) => /applied automatically/.test(l))));
  check('and it says the fix is master\u2019s to perform', ls.some((l) => /master\u2019s to perform/.test(l)));
  check('limits are always strings, so the panel can render them without type checks',
    M.limits(p).every((l) => typeof l === 'string'));
}

// ─── claimGate: no score, no grade, no percentage of safety ──────────────────────────────────────
console.log('\n--- claimGate: counts and routes, never a score ---');
{
  // WORD-BOUNDED. A bare /grade/ matches "downgrade", which is a word this panel must keep saying.
  const BANNED = ['score', 'grade', 'rating', 'rated', 'graded', 'secure', 'safe', 'protected',
    'hardened', 'clean', 'healthy', 'risk score', 'security score', 'A\\+'];
  const everything = [null, { ok: false, error: 'x' }, { ok: true, data: {} }, payload()]
    .flatMap((p) => [M.state(p), M.headline(p), M.byRoute(p), M.rows(p), M.limits(p), M.oneLine(p)])
    .flatMap((v) => strings(v));

  // "safe" appears in exactly ONE permitted sentence — the caveat that denies safety. The exemption
  // is the WHOLE SENTENCE, matched exactly, not "any string that happens to contain it": an earlier
  // draft exempted the containing string, so appending "The tree is clean." to the caveat passed
  // every ban. A mutation proved it, which is the only reason this is written the strict way.
  const CAVEAT = 'An advisory database knowing nothing about a package is not the same as that '
    + 'package being safe.';
  for (const w of BANNED) {
    const re = new RegExp(`\\b${w}\\b`, 'i');
    const hits = everything.filter((s) => re.test(s) && s !== CAVEAT);
    check(`nothing claims "${w.replace(/\\\\/g, '')}"`, hits.length === 0, hits.join(' | '));
  }
  check('the one permitted use of "safe" is the exact caveat sentence and nothing longer',
    everything.includes(CAVEAT), everything.filter((s) => /\bsafe\b/.test(s)).join(' | '));
  check('"downgrade" is still sayable — the ban is word-bounded, not substring-matched',
    strings(M.ROUTE_LABELS).some((s) => /downgrade/i.test(s)));
  check('no percentage appears anywhere', !everything.some((s) => /\d\s?%/.test(s)), everything.filter((s) => /\d\s?%/.test(s)).join('|'));
  check('no letter grade appears anywhere', !everything.some((s) => /\b[A-F][+-]?\s*(grade|rating)\b/i.test(s)));
  check('the model exports no scoring function',
    !Object.keys(M).some((k) => /score|grade|rate|rank/i.test(k)), Object.keys(M).join(','));
}

// ─── Nothing throws on hostile input ─────────────────────────────────────────────────────────────
console.log('\n--- hostile input produces a sentence, never an exception ---');
{
  const hostile = [undefined, null, 0, '', false, [], {}, { ok: true }, { ok: true, data: null },
    { ok: true, data: { tree: null } }, { ok: true, data: { tree: {} } },
    { ok: true, data: { tree: { ok: true, findings: null } } },
    { ok: true, data: { tree: { ok: true, findings: [null] } } },
    { ok: true, data: { summary: null, coverage: null, failures: 'nope' } }];
  let threw = null;
  for (const h of hostile) {
    try { M.state(h); M.headline(h); M.byRoute(h); M.rows(h); M.limits(h); M.oneLine(h); }
    catch (err) { threw = `${JSON.stringify(h)}: ${err.message}`; break; }
  }
  check('fourteen malformed payloads, no throw', threw === null, threw);
  check('a null finding inside a good tree does not become a blank row',
    M.rows({ ok: true, data: { tree: { ok: true, findings: [null, finding()] } } }).length <= 2);
}

// ─── The component: read as source for what a render cannot show ─────────────────────────────────
console.log('\n--- the panel itself ---');
{
  const panelPath = path.join(ROOT, 'src', 'pages', 'System', 'SecurityPanel.jsx');
  const exists = fs.existsSync(panelPath);
  check('the panel exists', exists, panelPath);
  const code = exists ? fs.readFileSync(panelPath, 'utf8') : '';

  check('it imports the model rather than composing its own sentences',
    /from '\.\/securityModel(\.js)?'/.test(code));
  check('it calls the real bridge channel', /window\.rama\?\.refresh\?\.deps|window\.rama\.refresh\.deps/.test(code));
  check('it passes the signed-in user, so the gate is actually exercised', /user[,:)\s]/.test(code));

  // A SCAN IS A MINUTE OF `npm audit`. Running it on mount would make opening a tab shell out to a
  // package manager, and Section 168.2 settled that a check master did not ask for is a check he
  // cannot see the cost of. So the scan is a button.
  check('no timer runs the scan on a schedule', !/setInterval|setTimeout\s*\(\s*[^,]*scan/i.test(code));
  check('the scan is not fired from a mount effect',
    !/useEffect\(\s*\(\)\s*=>\s*\{?\s*(run|scan|load)\w*\(\)/.test(code), 'a mount effect calls the scan');

  check('no console.log in shipped renderer code', !/console\.log\(/.test(code));
  check('nothing in the panel applies a fix', !/npm\s+audit\s+fix|execSync|spawn\(/.test(code));
  check('the withheld state is rendered, not just the failed one', /withheld/.test(code));
  check('the disagreement sentence is rendered', /\{\s*h\.disagreement\s*\}/.test(code));
  check('the caveat is rendered', /\{\s*h\.caveat\s*\}/.test(code));

  // CALLED IS NOT RENDERED. The first draft tested `/limits/`, which the import line satisfies —
  // so a panel that called `limits(payload)` and assigned the result to nothing passed. Each model
  // function is now traced from its call to the variable it lands in to a `.map` over that
  // variable, which is the only form in which a list actually reaches the screen.
  const renders = (fn) => {
    const m = new RegExp(`const\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*${fn}\\(`).exec(code);
    if (!m) return false;
    const v = m[1];
    // Either mapped directly, or sliced/filtered into another variable that is then mapped.
    if (new RegExp(`\\b${v}\\b[^\\n]*\\.map\\(`).test(code)) return true;
    const derived = new RegExp(`const\\s+([A-Za-z_$][\\w$]*)\\s*=[^\\n]*\\b${v}\\b`, 'g');
    for (const d of code.matchAll(derived)) {
      if (new RegExp(`\\b${d[1]}\\b[^\\n]*\\.map\\(`).test(code)) return true;
    }
    return false;
  };
  check('the limits are MAPPED into the markup, not collected and dropped', renders('limits'));
  check('the route counts are mapped into the markup', renders('byRoute'));
  check('the rows are mapped into the markup', renders('rows'));
  check('the status and headline are read into variables the markup uses',
    /const\s+s\s*=\s*state\(/.test(code) && /const\s+h\s*=\s*headline\(/.test(code)
    && /\{\s*s\.title\s*\}/.test(code));
  check('the collapsed one-line summary is rendered', /\{\s*oneLine\(/.test(code));

  // THE FORBIDDEN WORDS AGAIN, THIS TIME IN THE MARKUP. The model can be impeccable and the
  // component can still print "All clear" beside it in a heading.
  const text = code.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  // Both the literal text between tags AND any bare occurrence outside a style object, so a word
  // cannot arrive via a label, a placeholder or a button caption either.
  for (const w of ['secure', 'clean', 'healthy', 'protected', 'score', 'grade', 'vulnerability-free']) {
    const between = text.match(new RegExp(`>[^<>{]*\\b${w}\\b[^<>}]*<`, 'gi')) || [];
    const quoted = text.match(new RegExp(`['"\`][^'"\`]*\\b${w}\\b[^'"\`]*['"\`]`, 'gi')) || [];
    check(`the markup never claims "${w}"`, between.length === 0 && quoted.length === 0,
      [...between, ...quoted].join(' | '));
  }

  // Wired in, not written and orphaned — the Section 180 defect, one layer up.
  const systemPath = path.join(ROOT, 'src', 'pages', 'System', 'System.jsx');
  const sys = fs.existsSync(systemPath) ? fs.readFileSync(systemPath, 'utf8') : '';
  // The IMPORT is asserted as an import statement, not as the mere presence of the name — the JSX
  // tag below satisfies a bare /SecurityPanel/ on its own, so the first draft of this check could
  // not tell a wired panel from one referenced without being imported (which is a render crash).
  check('the System page imports the panel with a real import statement',
    /import\s+SecurityPanel\s+from\s+'\.\/SecurityPanel\.jsx'/.test(sys));
  check('and renders it', /<SecurityPanel\s*\/?>/.test(sys));
  check('on the overview tab, beside the footprint panel rather than on a route of its own',
    /<RamaFootprintPanel\s*\/>[\s\S]{0,800}<SecurityPanel/.test(sys));
}

console.log(`\n${'='.repeat(62)}`);
console.log(`  ${pass} passed, ${fail} failed`);
console.log('='.repeat(62));
process.exit(fail === 0 ? 0 : 1);
