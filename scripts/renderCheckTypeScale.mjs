#!/usr/bin/env node

/**
 * renderCheckTypeScale.mjs — the type scale and the width bands, read out of a REAL renderer.
 *
 * WHY THIS EXISTS (spec Section 136.15). verifyTypeScale.mjs reads source text: it proves the tokens
 * are declared, named consistently and above their floors, and that the band function is correct.
 * None of that proves a single pixel reached the screen. A `var(--fs-read)` whose token was deleted
 * still parses, still passes every source assertion, and silently inherits `body`'s 15px in the
 * browser. So this script starts the dev server, loads the app and reads COMPUTED sizes off the DOM.
 *
 * TWO COMPARISONS, NOT ONE. Each role's elements are asserted against the role's FLOOR *and* against
 * the role token's own computed value on `:root`. The floor alone cannot catch the failure above: a
 * broken `var(--fs-chrome)` inherits 15px and 15 >= 13 passes. The equality is what catches it.
 *
 * NO `window.rama` STUB, deliberately. `Unlock.jsx` computes `isElectron = !!window.rama`, so a stub
 * of any shape turns the passcode gate ON and makes every route unreachable. With the bridge absent
 * the renderer takes its own browser path (`onUnlocked({ devMode: true })`, `browserOnly: true` from
 * `instanceApi.info()`), and the master session seeded into sessionStorage under authClient.js's
 * SESSION_KEY is all that is needed to get past the gates.
 *
 * NOT IN THE `verify` CHAIN, and that is the point: the chain must run with no dev server and no
 * browser. This is `npm run verify:render`, run on its own.
 *
 * BROWSER. playwright 1.48.2 is already pinned in dependencies and nothing is added, but the browser
 * binaries are NOT downloaded (no %LOCALAPPDATA%\ms-playwright), so an installed channel is launched
 * instead: `msedge`, falling back to `chrome`. If neither launches this exits non-zero rather than
 * reporting a pass it never observed.
 *
 * [F3] HOW TO EXERCISE `compact` IN A REAL ELECTRON WINDOW. This script can set any viewport, so it
 * reaches `compact` where the shipped main window cannot. In the real app `bandFor` reads CSS px =
 * DIP / zoom, and electron/main.cjs:1265 pins minWidth at 900 DIP — which is 900 CSS px at zoom 1.0
 * and therefore `regular`, because the rule is `width < 900`. To see the compact titlebar for real:
 *   1. set zoom >= 1.05 (Settings > Appearance, or the zoom IPC), then drag the window to its
 *      900-DIP floor — 900 / 1.05 = 857 CSS px, which is compact; or
 *   2. open any StockMind pop-out, which is 420 DIP and therefore always compact.
 * Neither was changed in this run; the minWidth / BAND_REGULAR_MIN choice is master's (136.14).
 *
 * Run: node scripts/renderCheckTypeScale.mjs   (or npm run verify:render)
 */

import fs from 'fs';
import path from 'path';
import { spawn, execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

import { chromium } from 'playwright';
import { FLOORS } from '../src/config/type.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORIGIN = 'http://localhost:5173';

/* Screenshots land OUTSIDE the worktree, in the task's artifact root, so they can never be swept
   into a commit. The assertion below is the guard, not the comment. */
const RENDER_DIR = path.resolve(
  ROOT, '..', '..',
  '.agents/tasks/Rama_AGI-feat-legibility-responsive-2026-07-01/render',
);

let pass = 0;
let fail = 0;
const check = (label, ok, detail) => {
  if (ok) { pass += 1; console.log(`  PASS  ${label}`); }
  else { fail += 1; console.log(`  FAIL  ${label}${detail ? ` - ${detail}` : ''}`); }
};
const eq = (label, got, want) => check(label, got === want, `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

/* css name -> FLOORS key, the same map type.js publishes: `--fs-dense-lg` is FLOORS.denseLg. */
const ROLES = ['micro', 'chip', 'dense', 'dense-lg', 'chrome', 'chrome-lg', 'body', 'read', 'h3', 'h2', 'h1', 'display'];
const camel = (css) => css.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

/* The absolute floor under every role. Nothing in src may compute below this. */
const ABSOLUTE_FLOOR = 11;

const ROUTES = [
  '/', '/home', '/settings', '/stockmind', '/mind', '/knowledge', '/users', '/system',
  '/models', '/intel', '/agents', '/git', '/genome', '/introspect', '/resources',
  '/evolution', '/ide', '/terminal',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Waits for a lazily chunked page to finish painting, by polling the count of role-bearing elements
 * until it stops growing. A fixed timeout cannot do this job: at 900ms StockMind reported ZERO
 * `micro` elements and the role check passed VACUOUSLY on a page that had not mounted — the same
 * page reports 16 of them once settled. So the count is what is waited on, and the per-route role
 * census is printed, so a route that contributes nothing says so.
 */
async function settle(page, maxMs = 12000) {
  let last = -1;
  let stable = 0;
  for (let waited = 0; waited < maxMs; waited += 300) {
    await sleep(300);
    const n = await page.evaluate(() => document.querySelectorAll('[style*="var(--fs-"]').length);
    const loading = await page.evaluate(() => /LOADING MODULE/.test(document.body.innerText));
    if (!loading && n === last) { stable += 1; if (stable >= 3) return; } else { stable = 0; }
    last = n;
  }
}

const answers = async () => {
  try {
    const res = await fetch(ORIGIN, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch { return false; }
};

/** Starts `npm run dev:renderer` unless something already answers on 5173. */
async function startDevServer() {
  if (await answers()) {
    console.log(`        a server already answers on ${ORIGIN} — using it, and not tearing it down`);
    return null;
  }
  /* `shell: true` is required, not stylistic: since Node 18.20 spawning a `.cmd` directly fails with
     EINVAL (CVE-2024-27980), and npm on Windows IS a .cmd shim. The shell is also why teardown has
     to kill the whole tree below. */
  const proc = spawn('npm.cmd', ['run', 'dev:renderer'], {
    cwd: ROOT, stdio: 'ignore', windowsHide: true, shell: true,
  });
  proc.on('error', (err) => console.error(`  dev server spawn failed: ${err.message}`));
  for (let i = 0; i < 90; i += 1) {
    await sleep(1000);
    if (await answers()) return proc;
    if (proc.exitCode !== null) throw new Error(`dev server exited with code ${proc.exitCode}`);
  }
  throw new Error(`dev server did not answer on ${ORIGIN} within 90s`);
}

function stopDevServer(proc) {
  if (!proc || proc.exitCode !== null) return;
  /* npm.cmd is a shell wrapper, so killing it leaves vite running and still holding the port. The
     whole tree has to go, and SYNCHRONOUSLY: an async taskkill was measured to lose the race with
     this process exiting, which left a dev server listening on 5173 after the run. proc.kill alone
     reaches only the shell. */
  try {
    execFileSync('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  } catch { /* already gone, or not Windows — proc.kill below is the fallback */ }
  try { proc.kill(); } catch { /* already gone */ }
}

async function launchBrowser() {
  const tried = [];
  for (const channel of ['msedge', 'chrome']) {
    try {
      const browser = await chromium.launch({ channel });
      return { browser, channel };
    } catch (err) {
      tried.push(`${channel}: ${String(err.message).split('\n')[0]}`);
    }
  }
  throw new Error(`no installed browser channel launched — ${tried.join(' | ')}`);
}

/**
 * Reads everything this check needs out of ONE page, in the page's own context.
 *
 * Role elements are found by the role they CLAIM — the authored `var(--fs-<role>)` in the style
 * attribute — and then judged on what they COMPUTE. That binding is why no brittle text selector is
 * needed: every site claiming a role is checked, not one hand-picked anchor.
 */
const probe = ([roles, absoluteFloor]) => {
  const cs = getComputedStyle(document.documentElement);
  const out = {
    band: document.documentElement.dataset.band ?? null,
    paletteW: cs.getPropertyValue('--palette-w').trim(),
    tokens: {},
    roles: {},
    tooSmall: [],
    docScrollWidth: document.documentElement.scrollWidth,
    grids: [],
    boundaryText: null,
  };

  for (const r of roles) {
    out.tokens[r] = cs.getPropertyValue(`--fs-${r}`).trim();
    const els = Array.from(document.querySelectorAll(`[style*="var(--fs-${r})"]`));
    const sizes = {};
    for (const el of els) {
      const px = getComputedStyle(el).fontSize;
      sizes[px] = (sizes[px] ?? 0) + 1;
    }
    out.roles[r] = { count: els.length, sizes };
  }

  for (const el of document.querySelectorAll('*')) {
    const own = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim().length > 0);
    if (!own) continue;
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden') continue;
    const px = parseFloat(s.fontSize);
    if (!(px < absoluteFloor)) continue;
    const cls = typeof el.className === 'string' && el.className ? `.${el.className.split(' ')[0]}` : '';
    out.tooSmall.push(`${el.tagName.toLowerCase()}${cls} ${px}px "${el.textContent.trim().slice(0, 24)}"`);
  }

  /* `auto-fit` COLLAPSES empty tracks to 0px and getComputedStyle still lists them, so a raw track
     count never changes with width. Non-zero tracks are the ones that carry a cell. */
  for (const el of document.querySelectorAll('[style*="auto-fit, minmax("]')) {
    const authored = el.getAttribute('style').match(/minmax\((\d+)px/);
    out.grids.push({
      floor: authored ? Number(authored[1]) : null,
      tracks: getComputedStyle(el).gridTemplateColumns
        .split(' ').filter((t) => parseFloat(t) > 0).length,
    });
  }

  /* ErrorBoundary renders `<LABEL> FAILED` as a leaf, so a crashed route is reported as unreachable
     rather than counted as a silent pass by a probe that found no role elements. */
  const boundary = Array.from(document.querySelectorAll('div'))
    .find((el) => el.children.length === 0 && / FAILED$/.test(el.textContent.trim()));
  out.boundaryText = boundary ? boundary.textContent.trim().slice(0, 80) : null;

  return out;
};

/** One role's verdict across every element that claimed it. */
function judgeRoles(where, snap) {
  const broken = [];
  const seen = [];
  let total = 0;
  for (const r of ROLES) {
    const info = snap.roles[r];
    if (!info || info.count === 0) continue;
    seen.push(r);
    total += info.count;
    const token = parseFloat(snap.tokens[r]);
    const floor = FLOORS[camel(r)];
    for (const [px, n] of Object.entries(info.sizes)) {
      const v = parseFloat(px);
      if (v !== token) broken.push(`${r}: ${n} element(s) compute ${px}, token is ${snap.tokens[r]}`);
      else if (typeof floor === 'number' && v < floor) broken.push(`${r}: ${px} < floor ${floor}`);
    }
  }
  const census = seen.map((r) => `${r}x${snap.roles[r].count}`).join(' ');
  check(`${where}: ${seen.length} roles on ${total} elements compute their token, at or above floor`,
    broken.length === 0 && total > 0, broken.length > 0 ? broken.join('; ') : 'no role-bearing element found');
  console.log(`        ${census}`);
  return seen;
}

async function main() {
  console.log('\n--- the render check: computed sizes and the two band rules, in a real browser ---');

  let server = null;
  let browser = null;
  const unreachable = [];
  const reachable = [];
  const rolesSeen = new Set();

  try {
    check('the screenshot directory is outside the worktree',
      !RENDER_DIR.startsWith(ROOT + path.sep), RENDER_DIR);
    fs.mkdirSync(RENDER_DIR, { recursive: true });
    /* Cleared first, so the count at the end is this run's and not a previous run's leftovers. */
    for (const f of fs.readdirSync(RENDER_DIR)) {
      if (f.endsWith('.png')) fs.rmSync(path.join(RENDER_DIR, f));
    }

    server = await startDevServer();
    check(`the Vite dev server answers on ${ORIGIN}`, await answers());

    const launched = await launchBrowser();
    browser = launched.browser;
    console.log(`        browser channel: ${launched.channel} (no playwright binaries are downloaded)`);

    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });

    /* The ONLY seed. No window.rama — see the header. */
    await context.addInitScript(() => {
      try {
        sessionStorage.setItem('rama_session', JSON.stringify({
          token: 'render-check-session',
          user: { id: 'render-check', name: 'Krishna Prasad', tier: 0 },
          ts: Date.now(),
        }));
        localStorage.setItem('rama.paletteOpen', 'true');
        localStorage.setItem('rama.micMode', '"off"');
        localStorage.setItem('rama.micMuted', 'true');
      } catch { /* the check below is what reports a failed seed */ }
    });

    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(String(err.message).split('\n')[0]));

    await page.goto(`${ORIGIN}/#/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('textarea[placeholder^="Speak to Rāma"]', { timeout: 30000 });
    check('the seeded master session reaches the shell (the Chat composer is mounted)', true);

    // ── master authentication, so the subtitle exists to be shed ──────────────
    /* `.first()`: Chat's empty state also says ASSISTANT, and the titlebar is painted first. */
    await page.getByText('ASSISTANT', { exact: true }).first().click();
    await page.fill('input[placeholder="Master password"]', 'render-check');
    await page.keyboard.press('Enter');
    const subtitle = page.getByText('SUPER AGI · MASTER AUTHENTICATED', { exact: true });
    await subtitle.waitFor({ timeout: 15000 });
    check('at 1280 the titlebar subtitle IS rendered (so its absence at 860 means something)', true);
    check('at 1280 the Ctrl+K chip IS rendered', await page.getByText('Ctrl+K', { exact: true }).count() === 1);

    // ── a real message bubble, so `read` is checked on the body and not only the composer ──
    await page.fill('textarea[placeholder^="Speak to Rāma"]', 'RENDER-CHECK-PROBE');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1200);
    const bubble = await page.evaluate(() => {
      const el = Array.from(document.querySelectorAll('div'))
        .find((d) => d.textContent.trim() === 'RENDER-CHECK-PROBE' && d.children.length === 0);
      return el ? getComputedStyle(el).fontSize : null;
    });
    const composer = await page.evaluate(() =>
      getComputedStyle(document.querySelector('textarea[placeholder^="Speak to Rāma"]')).fontSize);
    eq(`the Chat message body computes read (floor ${FLOORS.read})`, bubble, '16px');
    eq(`the Chat composer computes read (floor ${FLOORS.read})`, composer, '16px');

    // ── 1280: regular ────────────────────────────────────────────────────────
    let snap = await page.evaluate(probe, [ROLES, ABSOLUTE_FLOOR]);
    eq('at 1280 the band is regular', snap.band, 'regular');
    eq('at 1280 --palette-w computes to the base width', snap.paletteW, '600px');
    for (const r of ROLES) {
      const floor = FLOORS[camel(r)];
      check(`--fs-${r} computes ${snap.tokens[r]}, at or above its floor ${floor}`,
        parseFloat(snap.tokens[r]) >= floor, `${snap.tokens[r]} < ${floor}`);
    }
    await page.screenshot({ path: path.join(RENDER_DIR, 'regular-1280.png'), fullPage: false });

    // ── every route, at regular: role fidelity and the absolute floor ────────
    console.log('\n--- per route, at 1280: computed role fidelity and the 11px floor ---');
    for (const route of ROUTES) {
      try {
        await page.evaluate((r) => { window.location.hash = `#${r}`; }, route);
        await settle(page);
        const s = await page.evaluate(probe, [ROLES, ABSOLUTE_FLOOR]);
        if (s.boundaryText) { unreachable.push(`${route} — page boundary: ${s.boundaryText}`); continue; }
        reachable.push(route);
        for (const r of judgeRoles(`${route} @1280`, s)) rolesSeen.add(r);
        check(`${route} @1280: nothing computes below ${ABSOLUTE_FLOOR}px`,
          s.tooSmall.length === 0, s.tooSmall.slice(0, 5).join('; '));
      } catch (err) {
        unreachable.push(`${route} — ${String(err.message).split('\n')[0]}`);
      }
    }
    check('the four role floors named in the plan were all observed on real elements',
      ['read', 'dense', 'chrome', 'micro'].every((r) => rolesSeen.has(r)),
      `observed: [${[...rolesSeen].sort()}]`);

    // ── 1700: wide. The jump regular -> wide, live ───────────────────────────
    console.log('\n--- 1700: the wide band rule ---');
    await page.evaluate(() => { window.location.hash = '#/stockmind'; });
    await settle(page);
    await page.setViewportSize({ width: 1700, height: 900 });
    await page.waitForTimeout(600);
    snap = await page.evaluate(probe, [ROLES, ABSOLUTE_FLOOR]);
    eq('at 1700 the band is wide (a live regular -> wide jump)', snap.band, 'wide');
    eq('at 1700 --palette-w computes to 760px', snap.paletteW, '760px');
    const wideTracks = snap.grids.map((g) => g.tracks);
    await page.screenshot({ path: path.join(RENDER_DIR, 'wide-1700.png'), fullPage: false });

    // ── 860: compact. The jump wide -> compact crosses both edges at once ────
    console.log('\n--- 860: the compact band rule, and no overflow ---');
    await page.setViewportSize({ width: 860, height: 900 });
    await page.waitForTimeout(400);
    snap = await page.evaluate(probe, [ROLES, ABSOLUTE_FLOOR]);
    eq('at 860 the band is compact (a live wide -> compact jump across both edges)', snap.band, 'compact');
    eq('at 860 --palette-w is back to the base width', snap.paletteW, '600px');
    eq('at 860 the titlebar subtitle is absent from the DOM',
      await page.getByText('SUPER AGI · MASTER AUTHENTICATED', { exact: true }).count(), 0);
    eq('at 860 the Ctrl+K chip is absent from the DOM',
      await page.getByText('Ctrl+K', { exact: true }).count(), 0);
    const narrowTracks = snap.grids.map((g) => g.tracks);
    check('the converted grids reflow to fewer tracks at 860 than at 1700',
      narrowTracks.length > 0 && wideTracks.length === narrowTracks.length
        && narrowTracks.every((n, i) => n <= wideTracks[i])
        && narrowTracks.some((n, i) => n < wideTracks[i]),
      `1700: [${wideTracks}] -> 860: [${narrowTracks}]`);
    await page.screenshot({ path: path.join(RENDER_DIR, 'compact-860.png'), fullPage: false });

    console.log('\n--- no modal or container overflows the 860px viewport ---');
    const overflows = [];
    for (const route of reachable) {
      await page.evaluate((r) => { window.location.hash = `#${r}`; }, route);
      await settle(page);
      const s = await page.evaluate(probe, [ROLES, ABSOLUTE_FLOOR]);
      if (s.docScrollWidth > 861) overflows.push(`${route}: ${s.docScrollWidth}px`);
      for (const r of judgeRoles(`${route} @860`, s)) rolesSeen.add(r);
      if (s.tooSmall.length > 0) {
        check(`${route} @860: nothing computes below ${ABSOLUTE_FLOOR}px`, false, s.tooSmall.slice(0, 5).join('; '));
      }
    }
    check('no reachable route scrolls horizontally at 860', overflows.length === 0, overflows.join('; '));

    // ── what this run did NOT reach, stated rather than implied ──────────────
    console.log('\n--- reachability: what this run covered, and what it could not ---');
    console.log(`        reachable routes (${reachable.length}/${ROUTES.length}): ${reachable.join(' ')}`);
    for (const u of unreachable) console.log(`        UNREACHABLE  ${u}`);
    console.log('        UNREACHABLE  CommandPalette self-modify card (the only --palette-w consumer):');
    console.log('                     mounts on uiStore.pendingModification, which no UI path sets, so the');
    console.log('                     760px is asserted on the computed :root property, not an element width');
    console.log('        UNREACHABLE  Agents SPAWN AGENT and Users ACCESS TIER grids: behind a click in a');
    console.log('                     modal; the two StockMind grids carry the same auto-fit form and reflow here');
    console.log('        UNREACHABLE  the shipped Electron main window at zoom 1.0 cannot be compact at all');
    console.log('                     (minWidth 900 DIP) — see the [F3] procedure in this file\'s header');
    if (pageErrors.length > 0) {
      console.log(`        page errors seen while the bridge was absent (not assertions): ${pageErrors.length}`);
      for (const e of [...new Set(pageErrors)].slice(0, 5)) console.log(`                     ${e}`);
    }

    const shots = fs.readdirSync(RENDER_DIR).filter((f) => f.endsWith('.png'));
    check('three screenshots written outside the worktree', shots.length >= 3, shots.join(', '));
    console.log(`        ${RENDER_DIR}`);
  } catch (err) {
    check('the render check ran to completion', false, String(err.message).split('\n')[0]);
  } finally {
    if (browser) await browser.close().catch(() => {});
    stopDevServer(server);
  }

  console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'} — ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main();
