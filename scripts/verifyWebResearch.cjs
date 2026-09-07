'use strict';

/**
 * verifyWebResearch.cjs — browser assimilation, and the source that must never be fabricated.
 *
 * Two things measured on this machine drove this suite, and both are asserted here so a later change
 * cannot quietly undo them:
 *
 *   1. `playwright` is installed and pinned while its bundled Chromium is ABSENT, yet Edge and Chrome
 *      are both present and both launch. So discovery must reach an installed browser, not give up.
 *   2. `buildFallbackResults()` scored 0.60 credibility and passed vetting, so a total search failure
 *      became a weighted source containing only the question.
 *
 * Existence checks are injected; nothing here needs a browser or a network.
 *
 * Run: node scripts/verifyWebResearch.cjs   (or npm run verify:web)
 */

const runtime = require('../electron/lib/browserRuntime.cjs');
const intel = require('../electron/ipc/intelligenceEngine.cjs');

let pass = 0;
let fail = 0;
function check(label, ok, detail) {
  if (ok) { pass += 1; console.log(`  PASS  ${label}`); }
  else { fail += 1; console.log(`  FAIL  ${label}${detail ? ` - ${detail}` : ''}`); }
}

const ENV = {
  ProgramFiles: 'C:\\Program Files',
  'ProgramFiles(x86)': 'C:\\Program Files (x86)',
  LOCALAPPDATA: 'C:\\Users\\k\\AppData\\Local',
};

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BRAVE = 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe';
const BUNDLED = 'C:\\Users\\k\\AppData\\Local\\ms-playwright\\chromium-1140\\chrome-win\\chrome.exe';

const pw = (bundledPath) => ({ chromium: { executablePath: () => bundledPath } });
const only = (...present) => (p) => present.includes(p);

(async () => {
  console.log('\nweb research — assimilating an installed browser, and refusing to invent sources\n');

  // ── 1. THE REAL SITUATION on this machine ──────────────────────────────────
  console.log('  the measured case: no bundled Chromium, but Edge and Chrome present');
  {
    const found = runtime.discover({ exists: only(EDGE, CHROME), playwright: pw(BUNDLED), env: ENV });

    check('a browser IS found even with no bundled Chromium', !!found.chosen);
    // The whole point of assimilation: the capability was owned and simply not reached for.
    check('Edge is chosen', found.chosen.id === 'msedge', found.chosen?.id);
    check('it is driven by channel, which is Playwright\'s supported route',
      found.chosen.how === 'channel' && found.chosen.launch.channel === 'msedge');
    check('both installed browsers are reported', found.available.length === 2,
      JSON.stringify(found.available.map(b => b.id)));
    check('the missing bundled Chromium is not offered',
      !found.available.some(b => b.id === 'chromium'));
    check('no remedy is suggested when a browser was found', found.reason === null);
    check('each candidate reports the evidence that found it',
      found.available.every(b => typeof b.evidence === 'string' && b.evidence.length > 0));
  }

  // ── 2. Preference order ────────────────────────────────────────────────────
  console.log('\n  preference order');
  {
    const withBundled = runtime.discover({ exists: only(BUNDLED, EDGE, CHROME), playwright: pw(BUNDLED), env: ENV });
    check('bundled Chromium wins when it is actually present',
      withBundled.chosen.id === 'chromium' && withBundled.chosen.how === 'bundled');
    check('and the installed browsers are still offered as alternatives',
      withBundled.available.length === 3);

    // Edge before Chrome deliberately: Edge ships with Windows, so preferring it makes behaviour
    // consistent across installs rather than dependent on what master happens to have added.
    const both = runtime.discover({ exists: only(CHROME, EDGE), playwright: pw(null), env: ENV });
    check('Edge is preferred over Chrome for consistency across machines',
      both.chosen.id === 'msedge', both.chosen?.id);

    const chromeOnly = runtime.discover({ exists: only(CHROME), playwright: pw(null), env: ENV });
    check('Chrome is used when Edge is absent', chromeOnly.chosen.id === 'chrome');

    // Playwright has no `brave` channel, so Brave is only reachable by explicit executable path.
    const braveOnly = runtime.discover({ exists: only(BRAVE), playwright: pw(null), env: ENV });
    check('Brave is reachable by explicit path', braveOnly.chosen.id === 'brave'
      && braveOnly.chosen.how === 'path');
    check('and its launch options carry that path',
      braveOnly.chosen.launch.executablePath === BRAVE);
  }

  // ── 3. Nothing available — the remedy must be actionable ───────────────────
  console.log('\n  nothing drivable');
  {
    const none = runtime.discover({ exists: () => false, playwright: pw(null), env: ENV });
    check('no browser yields no choice', none.chosen === null && none.available.length === 0);
    check('playwright is still reported as present', none.playwrightPresent === true);
    // "playwright not installed" was the old message and it was simply untrue.
    check('the remedy names both options rather than blaming the library',
      /install Microsoft Edge/.test(none.reason) && /playwright install chromium/.test(none.reason),
      none.reason);

    const noPw = runtime.discover({ exists: () => true, playwright: null, env: ENV });
    check('a missing playwright module is reported distinctly',
      noPw.playwrightPresent === false && /not installed/.test(noPw.reason));

    check('launchOptions returns null when nothing can be driven',
      runtime.launchOptions(none, { headless: true }) === null);
    check('launchOptions merges the caller\'s options with the chosen browser\'s',
      (() => {
        const f = runtime.discover({ exists: only(EDGE), playwright: pw(null), env: ENV });
        const o = runtime.launchOptions(f, { headless: true, args: ['--no-sandbox'] });
        return o.headless === true && o.channel === 'msedge' && o.args.length === 1;
      })());
  }

  // ── 4. Path expansion ──────────────────────────────────────────────────────
  console.log('\n  path expansion');
  {
    check('a variable is expanded',
      runtime.expand('%ProgramFiles%\\x\\y.exe', ENV).includes('C:\\Program Files'));
    // An unset variable must not produce a literal `%ProgramFiles%` path that then "does not exist"
    // for the wrong reason.
    check('an unset variable makes the candidate unresolvable rather than literal',
      runtime.expand('%NOPE%\\x.exe', ENV) === null);
    check('a plain absolute path passes through',
      runtime.expand('/usr/bin/google-chrome', ENV) !== null);
  }

  // ── 5. THE FABRICATION, and that it is now impossible ──────────────────────
  console.log('\n  a failed search must not become a credible source');
  {
    const marker = intel.buildFallbackResults('is qwen3.5 good at coding');

    check('the failure marker still exists so callers can tell searched-and-found-nothing apart',
      Array.isArray(marker) && marker.length === 1);
    check('it is flagged as a fallback', marker[0].fallback === true);
    // It used to echo the query back as `content`, which is what made it look like evidence.
    check('it carries NO content to be mistaken for evidence', marker[0].content === '');
    check('its title says plainly that nothing was found',
      /No sources found/.test(marker[0].title), marker[0].title);
    check('it no longer claims to be an analysis', marker[0].source === 'search-failed');

    // THE ASSERTION THIS SUITE EXISTS FOR.
    check('THE MARKER IS DROPPED BY VETTING and can never be weighed',
      intel.vetSources(marker).length === 0, JSON.stringify(intel.vetSources(marker)));

    // The domain still scores above the floor — proving the fix is the fallback filter, not a
    // credibility tweak that a future edit could undo without noticing.
    check('the internal domain still scores above the 0.40 floor, so the filter is what saves us',
      intel.getSourceCredibility('internal').score >= 0.40,
      String(intel.getSourceCredibility('internal').score));

    // Belt and braces: even a hand-made fallback with content is refused.
    check('a fallback entry with content is still refused',
      intel.vetSources([{ domain: 'internal', content: 'plausible text', fallback: true }]).length === 0);

    // An empty document cannot support or contradict anything, whatever its domain.
    check('an empty document from a credible domain is refused',
      intel.vetSources([{ domain: 'reuters.com', content: '   ' }]).length === 0);
    check('a missing content field is refused',
      intel.vetSources([{ domain: 'reuters.com' }]).length === 0);

    // And real sources must still pass, or the fix would have broken research entirely.
    const real = intel.vetSources([
      { domain: 'reuters.com', content: 'A real report with substance.' },
      { domain: 'ollama.com', content: 'Model documentation.' },
    ]);
    check('genuine sources still pass vetting', real.length === 2, JSON.stringify(real.length));
    check('vetted sources carry a credibility score',
      real.every(s => s.credibility && Number.isFinite(s.credibility.score)));
    check('they are ordered most credible first',
      real.every((s, i, a) => i === 0 || a[i - 1].credibility.score >= s.credibility.score));
  }

  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})();
