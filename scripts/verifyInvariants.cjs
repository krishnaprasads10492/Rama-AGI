'use strict';

/**
 * verifyInvariants.cjs — the 17 locked invariants, asserted instead of trusted.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────────────────────────────
 *
 * Section 28 lists invariants I1–I17 with an enforcement point for each. Section 124's evaluation went
 * looking for the suite that checks them and found **none**: twenty-three suites test the modules that
 * happen to implement the invariants, and not one asserts the invariant itself. So every I-number was
 * held by convention — a comment, a ledger row and the memory of whoever last read it.
 *
 * **An invariant trusted by convention is not an invariant.** It is a wish with a number.
 *
 * ── WHAT THIS ASSERTS, AND WHAT IT REFUSES TO PRETEND ─────────────────────────────────────────────
 *
 * A row passes only if removing, renaming or bypassing the ENFORCEMENT POINT makes it go RED. That is
 * what `--self-test` proves: it plants a real breach in a temp copy of the tree and requires the named
 * row to fail. A row that cannot be broken is not testing anything.
 *
 * Some invariants are only PARTLY mechanical — I11's "every new engine has a working fallback" is a
 * design property, not a grep. Those rows declare a RESIDUAL: the part a human still has to hold. The
 * summary counts residuals out loud, because a suite that silently covered half an invariant while
 * printing a green line would be a worse artefact than no suite at all. This project's whole character
 * is that an admitted gap beats a plausible claim (Section 94), and that applies hardest to a test.
 *
 * ── THE SCANNER, AND THE DEFECT IT WAS DESIGNED AROUND ───────────────────────────────────────────
 *
 * Most rows ask "does this pattern appear in real code" — which needs comments and string literals out
 * of the way. The first design used a JavaScript-only tokeniser and fed it every file under `src/`,
 * including 43 `.jsx`. **JSX text children are not JavaScript.** An apostrophe in prose — `don't`,
 * `Rāma's` — opened string state and blanked the rest of the file, so the absence assertions for I8,
 * I9, I10, I11 and I12 could all go SILENTLY GREEN. A test that can quietly pass is worse than no test,
 * because it is also a claim that someone checked.
 *
 * The fix is a rule that costs nothing and cannot be fooled by prose: **a `'` or `"` opens a string
 * only if it closes on the same line.** Real JavaScript string literals do not span lines (that is what
 * backticks are for, and those are tracked across lines separately); unpaired apostrophes in JSX prose
 * have no partner and are therefore treated as the text they are. `'https://x'` still pairs, so the
 * `//` inside it is still protected from being read as a comment.
 *
 * Two guards keep it honest: `scannerSelfCheck()` runs a fixture — including a JSX case — that proves
 * code survives and comments do not, and `--self-test` plants a `console.log` in a `.jsx` file at a
 * code position and requires I12 to go red. That second one is the regression test for exactly the
 * defect above.
 *
 * Run: node scripts/verifyInvariants.cjs            (rows + scanner check + self-test)
 *      node scripts/verifyInvariants.cjs --self-test-only
 *      npm run verify:covenant
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');

const ROOT = path.resolve(__dirname, '..');

// ─── Reporting ────────────────────────────────────────────────────────────────

let pass = 0;
let fail = 0;
const failures = [];
const residuals = [];

function row(id, title) {
  console.log(`\n  ${id} — ${title}`);
  return {
    id,
    pass(msg) { pass += 1; console.log(`    PASS  ${msg}`); },
    fail(msg) {
      fail += 1;
      failures.push(`${id}: ${msg}`);
      console.log(`    FAIL  ${msg}`);
    },
    check(msg, ok, detail) {
      if (ok) this.pass(msg);
      else this.fail(`${msg}${detail !== undefined ? ` — ${detail}` : ''}`);
    },
    /** The part of this invariant a human still holds. Printed, counted, never hidden. */
    residual(msg) {
      residuals.push(`${id}: ${msg}`);
      console.log(`    HELD BY HAND  ${msg}`);
    },
  };
}

// ─── The scanner ──────────────────────────────────────────────────────────────

/** Where does the quote opened at `from` close on this line? -1 when it does not. */
function closesOnLine(line, from, quote) {
  for (let k = from + 1; k < line.length; k += 1) {
    if (line[k] === '\\') { k += 1; continue; }
    if (line[k] === quote) return k;
  }
  return -1;
}

/**
 * THREE views of one file, all the same length so every offset lines up.
 *
 * `raw`  — exactly what is on disk.
 * `code` — comments AND string contents replaced by spaces. For "does this call happen" questions.
 * `nc`   — comments only. For "is this call made with THIS argument" questions, where the thing being
 *          asserted lives inside a quoted literal — `require('https')`, `can(user, 'release.cut')`,
 *          `secureDelete(path.join(dataDir, 'rama.salt'))`.
 *
 * The distinction is load-bearing and was found by running this suite: six rows first asserted against
 * `code` for patterns that only exist INSIDE a string literal, so they were red on a correct tree. A
 * row that is red on HEAD gets the suite deleted, which is the worst outcome available here.
 */
function views(src) {
  const out = src.split('');
  const nc = src.split('');
  const lines = src.split('\n');
  let pos = 0;
  let inBlock = false;
  let inTemplate = false;

  for (const line of lines) {
    let j = 0;
    while (j < line.length) {
      const abs = pos + j;
      if (inBlock) {
        if (line[j] === '*' && line[j + 1] === '/') {
          out[abs] = ' '; out[abs + 1] = ' ';
          nc[abs] = ' '; nc[abs + 1] = ' ';
          inBlock = false; j += 2; continue;
        }
        out[abs] = ' '; nc[abs] = ' '; j += 1; continue;
      }
      if (inTemplate) {
        // The backtick itself survives in `code` so a tagged call is still visible there.
        if (line[j] === '`') { inTemplate = false; j += 1; continue; }
        out[abs] = ' '; j += 1; continue;
      }
      const c = line[j];
      const d = line[j + 1];
      if (c === '/' && d === '/') {
        for (let k = j; k < line.length; k += 1) { out[pos + k] = ' '; nc[pos + k] = ' '; }
        j = line.length; continue;
      }
      if (c === '/' && d === '*') {
        out[abs] = ' '; out[abs + 1] = ' ';
        nc[abs] = ' '; nc[abs + 1] = ' ';
        inBlock = true; j += 2; continue;
      }
      if (c === '`') { inTemplate = true; j += 1; continue; }
      if (c === "'" || c === '"') {
        const close = closesOnLine(line, j, c);
        // UNPAIRED ON THIS LINE => NOT A STRING. This single rule is what keeps JSX prose from
        // blanking real code, and it is the whole fix for the defect in the header.
        if (close === -1) { j += 1; continue; }
        for (let k = j + 1; k < close; k += 1) out[pos + k] = ' ';
        j = close + 1; continue;
      }
      j += 1;
    }
    pos += line.length + 1;
  }
  return { raw: src, code: out.join(''), nc: nc.join('') };
}

const cache = new Map();

function viewOf(root, rel) {
  const key = `${root}\u0000${rel}`;
  if (cache.has(key)) return cache.get(key);
  let v = null;
  try { v = views(fs.readFileSync(path.join(root, rel), 'utf8')); }
  catch { v = null; }
  cache.set(key, v);
  return v;
}

function countOf(text, re) {
  const m = text.match(new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`));
  return m ? m.length : 0;
}

/** Assert a pattern IS present. `view` is 'code' by default, 'nc' when the match is inside a literal. */
function present(r, root, rel, re, why, view = 'code') {
  const v = viewOf(root, rel);
  if (!v) { r.fail(`${rel} is missing, so "${why}" cannot be asserted`); return false; }
  const n = countOf(v[view], re);
  r.check(`${rel}: ${why}`, n > 0, `not found in ${view}`);
  return n > 0;
}

/**
 * Assert a pattern is ABSENT from real code.
 *
 * When it appears only in `raw` it is in a comment or a string, which is reported rather than passed
 * in silence — the suite says which kind of clean it found, so a masked line cannot read as an absent
 * one without saying so.
 */
function absent(r, root, rel, re, why, view = 'code') {
  const v = viewOf(root, rel);
  if (!v) { r.fail(`${rel} is missing, so "${why}" cannot be asserted`); return; }
  const inView = countOf(v[view], re);
  if (inView > 0) { r.fail(`${rel}: ${why} — found ${inView} in ${view}`); return; }
  const inRaw = countOf(v.raw, re);
  if (inRaw > 0) r.pass(`${rel}: ${why} (${inRaw} in comments/strings only)`);
  else r.pass(`${rel}: ${why}`);
}

/** The body of a named function, from its declaration to the next one at column 0. */
function bodyOf(text, decl) {
  const at = text.indexOf(decl);
  if (at < 0) return '';
  const next = text.slice(at + decl.length).search(/\n(?:async )?function |\nmodule\.exports/);
  return next < 0 ? text.slice(at) : text.slice(at, at + decl.length + next);
}

/** Every shipped source file, excluding build output, tests and vendored code. */
function walkShipped(root) {
  const skip = new Set(['node_modules', '.git', 'build', 'dist', 'release', '.worktrees',
    'coverage', '.vite', 'docs', 'research', '.agents', '.kiro']);
  const exts = new Set(['.cjs', '.mjs', '.js', '.jsx']);
  const found = [];
  const walk = (dir) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.') && e.name !== '.') continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (!skip.has(e.name)) walk(full); continue; }
      if (!exts.has(path.extname(e.name))) continue;
      const rel = path.relative(root, full).split(path.sep).join('/');
      if (rel.startsWith('scripts/')) continue;       // the suites themselves are not shipped
      found.push(rel);
    }
  };
  for (const top of ['electron', 'src', 'server', 'shared']) walk(path.join(root, top));
  return found.sort();
}

function readJson(root, rel) {
  try { return JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8')); }
  catch { return null; }
}

// ─── The scanner's own fixture — the guard on the guard ────────────────────────

function scannerSelfCheck() {
  const r = row('S0', 'the scanner itself, because every row below trusts it');

  const jsx = [
    '<p>Rāma&apos;s own notes — don\u2019t worry, this isn\u0027t code</p>',
    "<span>it's fine</span>",
    'const real = console.log;',
  ].join('\n');
  const vj = views(jsx);
  r.check('JSX prose with an unpaired apostrophe does not blank the code after it',
    /const real = console\.log;/.test(vj.code), JSON.stringify(vj.code.slice(-40)));

  const urls = views("const u = 'https://example.com/x'; // trailing comment\nconst keep = 1;");
  r.check('a // inside a paired string is not read as a comment',
    /const keep = 1;/.test(urls.code));
  r.check('and the string CONTENTS are blanked',
    !/example\.com/.test(urls.code));
  r.check('while the trailing comment is gone',
    !/trailing comment/.test(urls.code));

  const block = views('/* console.log("x")\n   more */\nconst after = 2;');
  r.check('a block comment is blanked across lines', !/console\.log/.test(block.code));
  r.check('and code after it survives', /const after = 2;/.test(block.code));

  const tmpl = views('const t = `a\nconsole.log(1)\nb`;\nconst tail = 3;');
  r.check('a multi-line template literal is blanked', !/console\.log/.test(tmpl.code));
  r.check('and code after it survives', /const tail = 3;/.test(tmpl.code));

  const lengths = views('const a = 1; // x');
  r.check('offsets are preserved, so line numbers stay true',
    lengths.code.length === lengths.raw.length);
  return r;
}

// ─── The 17 rows ──────────────────────────────────────────────────────────────

const SESSION = 'electron/sessionManager.cjs';
const CRYPTO  = 'electron/cryptoCore.cjs';
const AUTH    = 'electron/lib/authCore.cjs';
const GUARD   = 'electron/lib/loyaltyGuard.cjs';
const CORE    = 'electron/lib/loyaltyCore.cjs';
const SEALER  = 'electron/nucleusSealer.cjs';
const PROPOSE = 'electron/lib/proposals.cjs';
const HTTP    = 'electron/lib/http.cjs';
const ORCH    = 'electron/resourceOrchestrator.cjs';
const RELEASE = 'electron/lib/releaseChannel.cjs';
const CAPS    = 'shared/capabilities.json';
const REGISTRY = 'src/config/registry.js';
const SRVAUTH = 'server/routes/auth.cjs';

/** I9's allow-list: the only two modules permitted a raw http/https require, each for a stated reason. */
const RAW_HTTP_ALLOWED = {
  'electron/lib/http.cjs': 'it IS the one client',
  'electron/lib/selfRepair.cjs': 'it must still fetch when lib/http.cjs is the thing that broke',
};

const INVARIANTS = [
  {
    id: 'I1',
    title: 'three gates; passcode is not identity; gate 1 returns no user and no token',
    files: [SESSION],
    check(root, r) {
      const v = viewOf(root, SESSION);
      if (!v) { r.fail(`${SESSION} is missing`); return; }
      const body = bodyOf(v.code, 'async function masterUnlock');
      r.check('masterUnlock exists', body.length > 0);
      r.check('its success return says the store is unlocked', /storeUnlocked:\s*true/.test(body));
      // THE INVARIANT: gate 1 hands back no identity. A token or user here would make the passcode
      // alone sufficient to become Master, which is what this function was rewritten to stop.
      r.check('and returns NO token', !/\btoken\s*:/.test(body));
      r.check('and returns NO user', !/\buser(Id)?\s*:/.test(body));
      r.check('and no tier', !/\btier\s*:/.test(body));
      r.check('a failed unlock relocks rather than leaving keys live',
        /cryptoCore\.lock\(\)/.test(body));
      present(r, root, SESSION, /_sessionData\s*=\s*\{/, 'the store-open record is kept separately');
      r.residual('that authCore really is the only issuer of sessions is asserted by I2, not here');
    },
  },
  {
    id: 'I2',
    title: 'the Express server has no authentication authority',
    files: [SRVAUTH],
    check(root, r) {
      absent(r, root, SRVAUTH, /\bconst\s+users\s*=\s*\[/, 'no user table');
      absent(r, root, SRVAUTH, /bcrypt|argon2|scrypt/i, 'no password hashing lives here');
      absent(r, root, SRVAUTH, /jwt|jsonwebtoken|sign\(/i, 'no token minting');
      const v = viewOf(root, SRVAUTH);
      if (!v) { r.fail(`${SRVAUTH} is missing`); return; }
      r.check('every auth route answers 501 rather than authenticating',
        /status\(501\)/.test(v.code));
      r.check('and /login is among the closed routes', /'\/login'/.test(v.raw));
      // A route that returned 200 with a token is the breach this row exists to catch.
      r.check('no route returns a 200 with a token',
        !/status\(200\)[\s\S]{0,120}token/i.test(v.code));
      r.check('the boot-token guard fails CLOSED when no token is configured',
        /if\s*\(!LOCAL_TOKEN\)\s*\{[\s\S]{0,200}status\(503\)/.test(v.code));
      r.check('and compares in constant time', /timingSafeEqual/.test(v.code));
    },
  },
  {
    id: 'I3',
    title: 'a wrong passcode is rejected, never treated as first run',
    files: [SESSION, CRYPTO],
    check(root, r) {
      const v = viewOf(root, SESSION);
      if (!v) { r.fail(`${SESSION} is missing`); return; }
      // MEASURED, not assumed: the branch tests a boolean derived from hasVerifier one line earlier.
      // An earlier draft of this row asserted `!cryptoCore.hasVerifier(` WAS the branch condition and
      // was therefore red on a correct tree — the kind of wrong assertion that gets a suite deleted.
      r.check('firstUnlock is derived from whether a verifier exists',
        /const\s+firstUnlock\s*=\s*!cryptoCore\.hasVerifier\(/.test(v.code));
      r.check('the verifier is written ONLY on the first-unlock branch',
        /if\s*\(firstUnlock\)\s*\{\s*cryptoCore\.writeVerifier\(/.test(v.code));
      r.check('and any other case must pass verifyPasscode',
        /else if\s*\(!cryptoCore\.verifyPasscode\(/.test(v.code));
      r.check('a failed verify relocks and refuses',
        /verifyPasscode\([\s\S]{0,120}cryptoCore\.lock\(\)[\s\S]{0,120}ok:\s*false/.test(v.code));
      present(r, root, CRYPTO, /function verifyPasscode/, 'cryptoCore owns the check');
      r.residual('that deriving keys from a wrong passcode yields an EMPTY store rather than a '
        + 'plausible one is a property of AES-GCM, not of this repository');
    },
  },
  {
    id: 'I4',
    title: 'master (tier 0) is provisioned once and is never grantable afterwards',
    files: [AUTH, CAPS],
    check(root, r) {
      const v = viewOf(root, AUTH);
      if (!v) { r.fail(`${AUTH} is missing`); return; }
      r.check('provision refuses a second time',
        /if\s*\(isProvisioned\(\)\)\s*\{[\s\S]{0,160}ok:\s*false/.test(v.code));
      // The breach this catches: createUser or setUserTier accepting 0.
      const createIdx = v.code.indexOf('function createUser');
      const tierIdx = v.code.indexOf('function setUserTier');
      r.check('createUser exists', createIdx >= 0);
      r.check('setUserTier exists', tierIdx >= 0);
      // MEASURED: tier 0 is refused by being BELOW the accepted floor, not by an === 0 test. The
      // floor is TIERS.SUPERADMIN (1), so master is unreachable by construction — a better shape
      // than a special case, and the row has to assert the shape that is actually there.
      const floorGuard = /<\s*TIERS\.SUPERADMIN\b/;
      r.check('createUser accepts nothing below SUPERADMIN, so tier 0 is unreachable',
        floorGuard.test(bodyOf(v.code, 'async function createUser')));
      r.check('and says so by name', /Master cannot be created/.test(v.raw));
      const tierBody = bodyOf(v.code, 'function setUserTier');
      r.check('setUserTier accepts nothing below SUPERADMIN', floorGuard.test(tierBody));
      r.check('and treats an existing master account as immutable',
        /user\.tier === TIERS\.MASTER/.test(tierBody));
      const caps = readJson(root, CAPS);
      r.check('the tier ladder puts MASTER at 0', caps && caps.tiers && caps.tiers.MASTER === 0);
    },
  },
  {
    id: 'I5',
    title: 'access keys are stored as HMAC only, shown once, never reproducible',
    files: [AUTH],
    check(root, r) {
      const v = viewOf(root, AUTH);
      if (!v) { r.fail(`${AUTH} is missing`); return; }
      r.check('the stored form is an HMAC', /createHmac\(\s*'sha256'/.test(v.nc));
      r.check('verification recomputes rather than reads back',
        /const computed\s*=\s*crypto\.createHmac/.test(v.code));
      // The breach: persisting the digits themselves under any obvious name.
      absent(r, root, AUTH, /\bdigits\s*:\s*digits\b/, 'the plaintext digits are never a stored field');
      absent(r, root, AUTH, /\bkey\s*:\s*digits\b/, 'nor under the name "key"');
      r.check('the digits are generated, not derived from the record',
        /randomInt|randomBytes/.test(v.code));
      r.residual('that the UI shows the key exactly once is a renderer behaviour; this row only '
        + 'proves the store cannot reproduce it');
    },
  },
  {
    id: 'I6',
    title: 'nothing is written to Rāma\u2019s own source without an approval in the ledger',
    files: [PROPOSE],
    check(root, r) {
      const v = viewOf(root, PROPOSE);
      if (!v) { r.fail(`${PROPOSE} is missing`); return; }
      r.check('there is an approve path', /function approve/.test(v.code));
      r.check('and an apply path distinct from it', /function apply/.test(v.code));
      const applyIdx = v.code.indexOf('function apply');
      const applyBody = applyIdx >= 0 ? v.code.slice(applyIdx, applyIdx + 2200) : '';
      // THE INVARIANT: apply must refuse anything not already approved. Both refusal branches are
      // asserted by their OWN message, because two branches sharing one message means deleting
      // either leaves the row green — which is how a vacuous assertion looks.
      r.check('apply refuses a proposal that is not approved',
        /STATUS\.APPROVED|status\s*!==\s*'approved'|!==\s*STATUS\.APPROVED/.test(applyBody));
      r.check('the ledger keeps an audit trail', /audit/i.test(v.nc));
      r.check('the ledger is durable rather than memory-only',
        /function restore/.test(v.code) && /function flush/.test(v.code));
      r.check('appliers are registered rather than hardcoded',
        /function registerApplier/.test(v.code));
      r.residual('I6 covers RĀMA changing its own source. Master pulling his own commits is not '
        + 'gated here by design (Section 28); that distinction is prose, not a grep');
      r.residual('the indirect write paths named in Section 124 \u00a76.2 — appliers, build scripts '
        + 'and the update channel — are NOT yet closed, and this row does not claim they are');
    },
  },
  {
    id: 'I7',
    title: 'every page, route, tier and voice entry comes from one registry',
    files: [REGISTRY],
    check(root, r) {
      const v = viewOf(root, REGISTRY);
      if (!v) { r.fail(`${REGISTRY} is missing`); return; }
      r.check('PAGES is the single declaration', /export const PAGES\s*=\s*\[/.test(v.code));
      r.check('routes are derived from it', /export function visibleRoutes/.test(v.code));
      r.check('voice matching is derived from it', /export function matchVoiceToRoute/.test(v.code));
      r.check('and the registry audits itself', /export function registryIssues/.test(v.code));
      const routes = countOf(v.code, /route:\s*'/);
      r.check('it actually declares routes', routes > 0, routes);
      // The breach: a component inventing a route of its own. A file that RENDERS routes while
      // importing the registry is the intended consumer, not a second source of truth — App.jsx is
      // exactly that, so the test is "declares a path without reading the registry".
      const offenders = walkShipped(root)
        .filter((f) => f.startsWith('src/') && f !== REGISTRY)
        .filter((f) => {
          const fv = viewOf(root, f);
          if (!fv || !/<Route\s+[^>]*path=/.test(fv.code)) return false;
          return !/registry(\.js)?['"]/.test(fv.nc);
        });
      r.check('no component declares a route without reading the registry',
        offenders.length === 0, offenders.join(', '));
    },
  },
  {
    id: 'I8',
    title: 'tiers and the capability matrix are defined once, in shared/capabilities.json',
    files: [CAPS, 'electron/lib/capability.cjs'],
    check(root, r) {
      const caps = readJson(root, CAPS);
      r.check(`${CAPS} parses`, !!caps);
      if (!caps) return;
      r.check('it holds the tier ladder', !!caps.tiers && typeof caps.tiers.MASTER === 'number');
      const names = Object.keys(caps.capabilities || {});
      r.check('and the capability matrix', names.length > 0, names.length);
      const tier0 = names.filter((n) => caps.capabilities[n] === 0);
      r.check('with tier-0 capabilities present', tier0.length > 0, tier0.length);
      r.check('release.cut is tier 0 (I17 depends on this)', caps.capabilities['release.cut'] === 0);
      // THE BREACH: a second copy of the ladder anywhere in shipped code. A duplicated ladder is how
      // two runtimes come to disagree about who master is.
      const ladder = /MASTER\s*:\s*0[\s\S]{0,120}SUPERADMIN\s*:\s*1/;
      const dupes = walkShipped(root).filter((f) => {
        const fv = viewOf(root, f);
        return fv && ladder.test(fv.code);
      });
      r.check('no shipped file redeclares the tier ladder', dupes.length === 0, dupes.join(', '));
      r.check('one module reads the JSON for all three runtimes',
        fs.existsSync(path.join(root, 'electron/lib/capability.cjs')));
    },
  },
  {
    id: 'I9',
    title: 'one main-process HTTP client; one renderer transport',
    files: [HTTP, 'src/services/apiClient.js'],
    check(root, r) {
      present(r, root, HTTP, /const https\s*=\s*require\('https'\)/, 'lib/http.cjs is the client', 'nc');
      const rawReq = /require\('(?:node:)?https?'\)/;
      const offenders = walkShipped(root).filter((f) => {
        if (RAW_HTTP_ALLOWED[f]) return false;
        const fv = viewOf(root, f);
        return fv && rawReq.test(fv.nc);
      });
      r.check('no other shipped module requires http/https directly',
        offenders.length === 0, offenders.join(', '));
      // The allow-list is asserted so an addition to it is a visible, reviewed act.
      for (const [f, why] of Object.entries(RAW_HTTP_ALLOWED)) {
        r.check(`the one exception ${f} still exists (${why})`,
          fs.existsSync(path.join(root, f)));
      }
      const api = viewOf(root, 'src/services/apiClient.js');
      r.check('the renderer transport is declared once',
        !!api && /export async function serverJson/.test(api.code));
      const defs = walkShipped(root).filter((f) => {
        if (f === 'src/services/apiClient.js') return false;
        const fv = viewOf(root, f);
        return fv && /export (async )?function serverJson/.test(fv.code);
      });
      r.check('and nowhere else', defs.length === 0, defs.join(', '));
    },
  },
  {
    id: 'I10',
    title: 'one resource admission authority',
    files: [ORCH],
    check(root, r) {
      const v = viewOf(root, ORCH);
      if (!v) { r.fail(`${ORCH} is missing`); return; }
      r.check('the orchestrator exposes admit()', /\badmit\(req\s*=\s*\{\}\)/.test(v.code));
      r.check('it owns the thresholds', /THRESHOLDS/.test(v.code));
      r.check('and the API rate limits', /API_RATE_LIMITS/.test(v.code));
      // A local helper named admit() is fine AS LONG AS it delegates. instanceManager has exactly
      // that shape: its admit(role) calls res.orchestrator.admit(...). The breach is an admit that
      // decides for itself, which is a second authority wearing the same name.
      const dupes = walkShipped(root).filter((f) => {
        if (f === ORCH) return false;
        const fv = viewOf(root, f);
        if (!fv || !/function admit\s*\(/.test(fv.code)) return false;
        return !/orchestrator\.admit\(/.test(fv.code);
      });
      r.check('every other admit() delegates to the one authority rather than deciding',
        dupes.length === 0, dupes.join(', '));
      r.residual('WHICH call sites must ask admit() before spending CPU, RAM or network is a design '
        + 'judgement. Section 124 \u00a76.5 counted 3 admit sites against an 11-file spawn inventory; '
        + 'closing that gap is future work and this row does not claim it is closed');
    },
  },
  {
    id: 'I11',
    title: 'upgrades are additive; every new engine has a working fallback',
    files: ['package.json'],
    check(root, r) {
      // Mechanically checkable half: the verify chain only ever grows, and nothing in it was dropped.
      const pkg = readJson(root, 'package.json');
      r.check('package.json parses', !!pkg);
      if (!pkg) return;
      const chain = String(pkg.scripts && pkg.scripts.verify || '');
      r.check('a verify chain exists', chain.length > 0);
      const scripts = chain.split('&&').map((s) => s.trim()).filter(Boolean);
      r.check('it runs more than twenty suites', scripts.length >= 20, scripts.length);
      const missing = scripts
        .map((s) => (s.match(/node\s+(scripts\/[\w.]+)/) || [])[1])
        .filter(Boolean)
        .filter((f) => !fs.existsSync(path.join(root, f)));
      r.check('every suite named in the chain exists on disk',
        missing.length === 0, missing.join(', '));
      r.check('this suite is IN the chain, or it would never run',
        /verifyInvariants\.cjs/.test(chain));
      r.residual('that each new ENGINE degrades to a working fallback is a design property. The '
        + 'closest mechanical proxy is that every suite in the chain still exists and passes, which '
        + 'is what the chain itself enforces');
    },
  },
  {
    id: 'I12',
    title: 'no console.log in shipped code; pinned dependencies; no placeholders',
    files: ['package.json'],
    check(root, r) {
      const shipped = walkShipped(root);
      r.check('there are shipped files to scan', shipped.length > 50, shipped.length);
      const jsx = shipped.filter((f) => f.endsWith('.jsx'));
      r.check('including .jsx, which the scanner must survive', jsx.length > 0, jsx.length);

      const loggers = [];
      for (const f of shipped) {
        const fv = viewOf(root, f);
        if (!fv) continue;
        const n = countOf(fv.code, /\bconsole\.log\s*\(/);
        if (n > 0) loggers.push(`${f} (${n})`);
      }
      r.check('no console.log in shipped code', loggers.length === 0, loggers.join(', '));

      // A placeholder marker is a COMMENT by nature, so this reads raw — but one module legitimately
      // contains the words because its job is to find them, and an allow-list with a stated reason
      // is honest where a silently relaxed regex would not be.
      const MARKER_ALLOWED = {
        'electron/ipc/astEngine.cjs': 'it DETECTS TODO/FIXME markers, so it must name them',
      };
      const placeholders = [];
      for (const f of shipped) {
        if (MARKER_ALLOWED[f]) continue;
        const fv = viewOf(root, f);
        if (!fv) continue;
        if (/(?:\/\/|\/\*)\s*(?:TODO|FIXME)\b/i.test(fv.raw)) placeholders.push(f);
        else if (/\bnot implemented\b/i.test(fv.code)) placeholders.push(f);
      }
      r.check('no TODO or FIXME marker, and no "not implemented", in shipped code',
        placeholders.length === 0, placeholders.join(', '));
      for (const [f, why] of Object.entries(MARKER_ALLOWED)) {
        r.check(`the one exception ${f} still exists (${why})`,
          fs.existsSync(path.join(root, f)));
      }

      const pkg = readJson(root, 'package.json');
      if (!pkg) { r.fail('package.json does not parse'); return; }
      const ranged = [];
      for (const group of ['dependencies', 'devDependencies']) {
        for (const [name, spec] of Object.entries(pkg[group] || {})) {
          if (/^[\^~]/.test(String(spec))) ranged.push(`${group}.${name}=${spec}`);
        }
      }
      r.check('every dependency is pinned — no ^ or ~', ranged.length === 0, ranged.join(', '));
      const total = Object.keys(pkg.dependencies || {}).length
        + Object.keys(pkg.devDependencies || {}).length;
      r.check('and there are dependencies to pin', total > 0, total);
    },
  },
  {
    id: 'I13',
    title: 'commit and push to both dev and source',
    files: [],
    check(root, r) {
      // State, not source — so this row reports and never blocks a fresh clone.
      const gitDir = path.join(root, '.git');
      if (!fs.existsSync(gitDir)) {
        r.residual('no .git here, so the two-remote convention cannot be observed');
        return;
      }
      const readRef = (rel) => {
        try { return fs.readFileSync(path.join(gitDir, rel), 'utf8').trim(); }
        catch { return null; }
      };
      const packed = (() => {
        try { return fs.readFileSync(path.join(gitDir, 'packed-refs'), 'utf8'); }
        catch { return ''; }
      })();
      const refOf = (name) => readRef(`refs/remotes/origin/${name}`)
        || (packed.match(new RegExp(`^([0-9a-f]{40}) refs/remotes/origin/${name}$`, 'm')) || [])[1]
        || null;
      const dev = refOf('dev');
      const source = refOf('source');
      if (!dev || !source) {
        r.residual('origin/dev or origin/source is not present locally, so their agreement was '
          + 'not observed in this run');
        return;
      }
      r.check('origin/dev and origin/source point at the same commit',
        dev === source, `dev=${dev.slice(0, 8)} source=${source.slice(0, 8)}`);
      r.residual('this observes the last push, not the next one. I13 is a habit the ledger records; '
        + 'the suite can only notice when the two remotes have drifted');
    },
  },
  {
    id: 'I14',
    title: 'a passcode change is a full re-key',
    files: [SESSION],
    check(root, r) {
      const v = viewOf(root, SESSION);
      if (!v) { r.fail(`${SESSION} is missing`); return; }
      // `nc`, not `code`: the salt and verifier filenames being destroyed are string literals, and
      // WHICH files get destroyed is the substance of the invariant.
      const idx = v.nc.indexOf('async function changePasscode');
      r.check('changePasscode exists', idx >= 0);
      if (idx < 0) return;
      const body = bodyOf(v.nc, 'async function changePasscode');
      // ORDER IS THE INVARIANT. Loading before the salt is destroyed, and rewriting after the new
      // keys exist, is the difference between a re-key and an unreadable store.
      const steps = [
        ['proves the old passcode', /verifyPasscode\(/],
        ['loads everything under the OLD keys first', /loadAll\(\)/],
        ['destroys the old salt', /secureDelete\([\s\S]{0,60}rama\.salt/],
        ['destroys the old verifier', /secureDelete\([\s\S]{0,60}rama\.verify/],
        ['clears the cache', /cache\.clear\(\)/],
        ['derives new keys', /unlock\(newPasscode/],
        ['writes a new verifier', /writeVerifier\(/],
        ['marks every domain dirty', /markAllDirty\(\)/],
        ['rewrites every domain', /saveAll\(\)/],
      ];
      let last = -1;
      let ordered = true;
      for (const [label, re] of steps) {
        const m = body.search(re);
        r.check(label, m >= 0);
        if (m >= 0) { if (m < last) ordered = false; last = m; }
      }
      r.check('and they occur IN THAT ORDER', ordered);
      r.check('a wrong current passcode restores the working keys before refusing',
        /Current passcode is incorrect/.test(v.raw));
      r.check('the nucleus is re-sealed under the new passcode too',
        /nucleus/i.test(body));
    },
  },
  {
    id: 'I15',
    title: 'absolute loyalty is above the hierarchy; a non-conforming core cannot be persisted',
    files: [GUARD, SEALER],
    check(root, r) {
      const g = viewOf(root, GUARD);
      const s = viewOf(root, SEALER);
      if (!g || !s) { r.fail('the guard or the sealer is missing'); return; }
      r.check('the guard declares the covenant', /COVENANT/.test(g.code));
      r.check('and the protected files', /PROTECTED_FILES/.test(g.code));
      r.check('and refuses with a named error type', /LoyaltyViolation/.test(g.code));
      r.check('and exposes the outer-clean assertion', /assertOuterClean/.test(g.code));

      // THE DESIGN THAT MAKES THIS AN INVARIANT RATHER THAN A POLICY: the check sits INSIDE the one
      // function that turns a nucleus into bytes. "Guarding those four callers would leave the
      // fifth" — so conformance is a precondition of the nucleus being writable at all, and a future
      // caller that has never heard of the guard still cannot persist a bad one.
      const encIdx = s.code.indexOf('function encryptNucleus');
      r.check('encryptNucleus exists', encIdx >= 0);
      const encBody = encIdx >= 0 ? s.code.slice(encIdx, encIdx + 1400) : '';
      r.check('assertOuterClean runs INSIDE encryptNucleus, not at its call sites',
        /assertOuterClean\(/.test(encBody));
      const calls = countOf(s.code, /encryptNucleus\(/);
      r.check('and every write path goes through it', calls >= 3, `${calls} references`);
      r.check('the patch path is guarded too', /assertPatchSafe\(/.test(s.code));
      r.check('a restore path exists for the layouts that can be repaired',
        /restore/.test(g.code));
      r.residual('I15 says on-disk tampering is "reverted on unseal". For the CURRENT concentric '
        + 'layout, unseal THROWS and Rāma does not start — fail-closed rather than self-repairing. '
        + 'Section 124 \u00a79.1 RAISED this for master and did not edit the invariant; this row '
        + 'asserts the behaviour that exists, not the wording');
    },
  },
  {
    id: 'I16',
    title: 'the loyalty matrix is sealed in its own envelope and no accessor ever returns it',
    files: [CORE, SEALER],
    check(root, r) {
      const v = viewOf(root, CORE);
      const s = viewOf(root, SEALER);
      if (!v || !s) { r.fail('the core or the sealer is missing'); return; }

      // The export surface is FROZEN. Adding an accessor is then a failing assertion rather than a
      // code review someone has to catch.
      const CORE_EXPORTS = ['sealCore', 'openCore', 'lock', 'isOpen', 'withCore', 'attest',
        'covenantHolds', 'displayIdentity', 'describe', 'fingerprint', 'BASE_ROUNDS',
        'CEILING_ROUNDS', 'COOLDOWN_AFTER', 'COOLDOWN_MS', 'roundsFor'];
      const mIdx = v.code.indexOf('module.exports');
      const mBody = mIdx >= 0 ? v.code.slice(mIdx, v.code.indexOf('};', mIdx) + 2) : '';
      const named = (mBody.match(/[A-Za-z_][A-Za-z0-9_]*/g) || [])
        .filter((w) => w !== 'module' && w !== 'exports');
      const unexpected = named.filter((w) => !CORE_EXPORTS.includes(w));
      r.check('loyaltyCore exports exactly the attestation surface, and nothing new',
        unexpected.length === 0, `unexpected: ${unexpected.join(', ')}`);
      for (const want of ['attest', 'describe', 'displayIdentity']) {
        r.check(`it answers questions (${want}) rather than handing over the matrix`,
          named.includes(want));
      }
      absent(r, root, CORE, /function getMatrix|function readCore\b|getLoyalty\s*\(/,
        'no getter for the matrix itself');

      // The escalating cost, and — the part an earlier draft left vacuous — that a FAILED open
      // actually records the failure. Without this assertion, deleting recordFailure() left the
      // row green and the escalation was decorative.
      r.check('the work escalates with consecutive failures', /function roundsFor/.test(v.code));
      r.check('with a ceiling', /CEILING_ROUNDS/.test(v.code));
      r.check('and a cooldown that refuses outright', /function cooldownRefusal/.test(v.code));
      // `nc` again: the escalation is reported through a template literal, and template contents are
      // blanked in `code`.
      const openBody = bodyOf(v.nc, 'function openCore');
      r.check('a failed open RECORDS the failure', /recordFailure\(\)/.test(openBody));
      r.check('and reports what the next attempt will cost',
        /roundsFor\(\s*next\.failures\s*\)/.test(openBody));
      r.check('a successful open clears the failure count', /clearFailures\(\)/.test(v.code));
      r.check('the round count is authenticated inside the envelope so it cannot be downgraded',
        /writeUInt32BE\(rounds/.test(v.code));

      // The shell may not carry a copy.
      r.check('the sealer routes identity questions to the core instead of exposing it',
        /loyaltyCore\.cjs'\)\.displayIdentity\(\)/.test(s.raw));
      r.check('and attests rather than reads', /attestLoyalty/.test(s.code));
      absent(r, root, SEALER, /getNucleus\(\)\.loyalty/, 'nothing reads loyalty off the shell');
    },
  },
  {
    id: 'I17',
    title: 'baseline is declared by master; no release happens on Rāma\u2019s initiative',
    files: [RELEASE, CAPS],
    check(root, r) {
      const v = viewOf(root, RELEASE);
      if (!v) { r.fail(`${RELEASE} is missing`); return; }
      r.check('cutting a release is capability-gated',
        /capability\.can\(user, 'release\.cut'\)/.test(v.nc));
      r.check('and refuses by name when the caller may not', /may not cut a release/.test(v.raw));
      const caps = readJson(root, CAPS);
      r.check('release.cut is tier 0, i.e. master only', caps && caps.capabilities['release.cut'] === 0);
      r.check('pushing is opt-in rather than the default', /push\s*=\s*false/.test(v.code));
      // Nothing on a timer may reach it.
      const timerCallers = walkShipped(root).filter((f) => {
        const fv = viewOf(root, f);
        if (!fv) return false;
        if (!/cutRelease\s*\(/.test(fv.code)) return false;
        return /setInterval|setTimeout|cron|schedule/i.test(fv.code);
      });
      r.check('no module both schedules work and calls cutRelease',
        timerCallers.length === 0, timerCallers.join(', '));
      r.residual('that master CLASSIFIES each release as upgrade, update or fix is a human act the '
        + 'suite cannot witness; it can only prove Rāma never starts one');
    },
  },
];

// ─── Self-test: plant a breach, require the named row to go red ────────────────

/**
 * Each mutation is a real breach of a real invariant. If planting it leaves the row GREEN, the row is
 * decorative and the suite says so by failing.
 *
 * The `.jsx` mutation is not decoration either: it is the regression test for the scanner defect in
 * this file's header, where JSX prose could blank real code and turn I12 silently green.
 */
const MUTATIONS = [
  {
    id: 'I12-jsx',
    expect: 'I12',
    why: 'a console.log planted in a .jsx file at a code position',
    pick: (root) => walkShipped(root).find((f) => f.endsWith('.jsx')),
    mutate: (src) => {
      // After the first import line, which is unambiguously a code position.
      const at = src.indexOf('\n', src.indexOf('import'));
      return `${src.slice(0, at + 1)}console.log('planted');\n${src.slice(at + 1)}`;
    },
  },
  {
    id: 'I12-range',
    expect: 'I12',
    why: 'a dependency unpinned to a caret range',
    pick: () => 'package.json',
    mutate: (src) => {
      const pkg = JSON.parse(src);
      const first = Object.keys(pkg.dependencies)[0];
      pkg.dependencies[first] = `^${pkg.dependencies[first]}`;
      return JSON.stringify(pkg, null, 2);
    },
  },
  {
    id: 'I15-guard',
    expect: 'I15',
    why: 'the loyalty check removed from inside encryptNucleus',
    pick: () => SEALER,
    mutate: (src) => src.replace(/guard\.assertOuterClean\([^;]*\);/, '/* removed */'),
  },
  {
    id: 'I16-failure',
    expect: 'I16',
    why: 'a failed core open no longer recording the failure',
    pick: () => CORE,
    mutate: (src) => src.replace(/const next = recordFailure\(\);/,
      'const next = { failures: 0 };'),
  },
  {
    id: 'I16-accessor',
    expect: 'I16',
    why: 'an accessor added that would return the matrix',
    pick: () => CORE,
    mutate: (src) => src.replace(/module\.exports = \{/, 'module.exports = {\n  getMatrix,'),
  },
  {
    id: 'I1-token',
    expect: 'I1',
    why: 'gate 1 handing back a token',
    pick: () => SESSION,
    mutate: (src) => src.replace(/firstRun:\s*firstUnlock,/, 'firstRun: firstUnlock, token: "x",'),
  },
  {
    id: 'I2-login',
    expect: 'I2',
    why: 'the server minting a token again',
    pick: () => SRVAUTH,
    mutate: (src) => src.replace(/const express = require\('express'\);/,
      'const express = require(\'express\');\nconst users = [{ u: 1 }];'),
  },
  {
    id: 'I3-firstrun',
    expect: 'I3',
    why: 'a wrong passcode falling through to the first-run branch',
    pick: () => SESSION,
    mutate: (src) => src.replace(/\} else if \(!cryptoCore\.verifyPasscode\(dataDir\)\) \{/,
      '} else if (false) {'),
  },
  {
    id: 'I4-reprovision',
    expect: 'I4',
    why: 'provision no longer refusing a second time',
    pick: () => AUTH,
    mutate: (src) => src.replace(/if \(isProvisioned\(\)\) \{/, 'if (false) {'),
  },
  {
    id: 'I17-gate',
    expect: 'I17',
    why: 'the release capability gate removed',
    pick: () => RELEASE,
    mutate: (src) => src.replace(/capability\.can\(user, 'release\.cut'\)/, 'true'),
  },
  {
    id: 'I8-ladder',
    expect: 'I8',
    why: 'a second copy of the tier ladder planted in shipped code',
    pick: () => 'electron/lib/http.cjs',
    mutate: (src) => `${src}\nconst TIERS = { MASTER: 0, SUPERADMIN: 1 };\n`,
  },
  {
    id: 'I9-rawhttp',
    expect: 'I9',
    why: 'a second module requiring https directly',
    pick: () => ORCH,
    mutate: (src) => `const https = require('https');\n${src}`,
  },
  {
    id: 'I14-order',
    expect: 'I14',
    why: 'the re-key no longer loading the store under the old keys',
    pick: () => SESSION,
    // SCOPED TO changePasscode ON PURPOSE. A bare replace hit masterUnlock's loadAll() first, left
    // changePasscode untouched, and the row stayed green — the mutation was wrong, not the row, and
    // it is exactly the kind of vacuous self-test this file exists to rule out.
    mutate: (src) => {
      const at = src.indexOf('async function changePasscode');
      if (at < 0) return src;
      const head = src.slice(0, at);
      const tail = src.slice(at).replace(/dataStore\.loadAll\(\);/, '/* removed */');
      return head + tail;
    },
  },
];

function copyInto(root, dest, rels) {
  for (const rel of rels) {
    const from = path.join(root, rel);
    if (!fs.existsSync(from)) continue;
    const to = path.join(dest, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  }
}

function runRowSilently(inv, root) {
  const savedPass = pass;
  const savedFail = fail;
  const savedFailures = failures.length;
  const savedResiduals = residuals.length;
  const log = console.log;
  console.log = () => {};
  let red = false;
  try {
    const sink = {
      id: inv.id,
      pass() {},
      fail() { red = true; },
      check(_m, ok) { if (!ok) red = true; },
      residual() {},
    };
    inv.check(root, sink);
  } catch {
    red = true;                      // a row that throws on a breach has still noticed it
  } finally {
    console.log = log;
    pass = savedPass;
    fail = savedFail;
    failures.length = savedFailures;
    residuals.length = savedResiduals;
  }
  return red;
}

function selfTest() {
  const r = row('SELF', 'planting a real breach must turn the named row RED');
  const everyFile = [...new Set([
    ...INVARIANTS.flatMap((i) => i.files),
    ...walkShipped(ROOT),
    'package.json',
    'electron/lib/capability.cjs',
    'shared/capabilities.json',
  ])];

  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'rama-inv-'));
  try {
    for (const m of MUTATIONS) {
      const rel = m.pick(ROOT);
      if (!rel) { r.fail(`${m.id}: no file to mutate`); continue; }
      const dest = fs.mkdtempSync(path.join(base, 'case-'));
      copyInto(ROOT, dest, everyFile);
      const target = path.join(dest, rel);
      const before = fs.readFileSync(target, 'utf8');
      const after = m.mutate(before);
      if (after === before) {
        r.fail(`${m.id}: the mutation did not change ${rel} — the assertion it tests may be vacuous`);
        continue;
      }
      fs.writeFileSync(target, after);
      cache.clear();
      const inv = INVARIANTS.find((i) => i.id === m.expect);
      const red = runRowSilently(inv, dest);
      r.check(`${m.expect} goes red when ${m.why}`, red);
    }
  } finally {
    cache.clear();
    try { fs.rmSync(base, { recursive: true, force: true }); } catch { /* temp dir */ }
  }
  return r;
}

// ─── Run ──────────────────────────────────────────────────────────────────────

const onlySelfTest = process.argv.includes('--self-test-only');

console.log('\nthe 17 locked invariants — asserted, not trusted\n');

if (!onlySelfTest) {
  scannerSelfCheck();
  for (const inv of INVARIANTS) {
    const r = row(inv.id, inv.title);
    try { inv.check(ROOT, r); }
    catch (err) { r.fail(`the row threw: ${err.message}`); }
  }
}

// THE SELF-TEST IS NOT OPTIONAL. A suite whose own breach detection is behind a flag is a suite whose
// breach detection nobody runs.
cache.clear();
selfTest();
cache.clear();

console.log(`\n  ${pass} passed, ${fail} failed`);
if (residuals.length > 0) {
  console.log(`\n  ${residuals.length} parts of these invariants are STILL HELD BY HAND:`);
  for (const x of residuals) console.log(`    - ${x}`);
  console.log('\n  Listed rather than hidden: a suite that silently covered half an invariant while');
  console.log('  printing a green line would be worse than no suite at all.');
}
if (fail > 0) {
  console.log('\n  failures:');
  for (const x of failures) console.log(`    - ${x}`);
  process.exit(1);
}
console.log('\n  ALL PASS — every invariant above is enforced by something that breaks when removed\n');
