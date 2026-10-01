# Design — Rāma AGI model-evaluation tranche 1: verification machinery

**Iteration:** third. `design-review.json` exists (verdict `CHANGES_REQUESTED`, **2 HIGH / 12 MEDIUM /
7 NIT**, findings 1–21), so this is a **revision**. Every HIGH and MEDIUM is resolved in place, and
every NIT is either taken or answered; §14 records the response to each of the 21 findings, and §15
retains the iteration-1 responses for the record. **Every finding in this round re-measured true** —
there is no "the review was wrong" column this time; the four misquoted line numbers, the inverted
`approve` branches, the 19th `route:`, the absent `warnOnce` and the unkeyed literal extractor were
all confirmed in source before being fixed (the commands are in §14).
**Worktree:** `.worktrees/model-eval`, branch `model/agi-evaluation`, HEAD `8c1c9ee`.
**Requirements:** `.agents/tasks/model-eval/requirements.md` (R1, R2, R3, R4).
**Spec:** `RAMA_AGI_MASTER_SPEC.md` Section 28 (lines **1607–1818**, bounded by `## SECTION 29` at
1818) was read for I1–I17's "Where enforced" column and is **not modified by this tranche**. No
invariant is re-litigated; the places where the spec's wording and the code diverge are **raised in
§12**, not edited.

Everything labelled *measured* below was re-measured in this worktree while writing this revision,
with the command recorded. Nothing is carried over from the first iteration on trust.

---

## Overview

Three artefacts, one spine. `scripts/verifyInvariants.cjs` asserts that each of I1–I17's enforcement
point is present, correctly named, actually called at its boundary, and not weakened — and proves it
notices, by planting a breach in a throwaway overlay and requiring the matching row to go red.
`scripts/verifyLoyaltyTripwire.cjs` makes any change to the loyalty core fail `npm run verify` and
`electron-builder`'s `beforeBuild` unless master's approval for that exact content is recorded in a
committed file whose every entry must name text that exists inside Section 28 of the spec.
`electron/lib/staleness.cjs` plus `scripts/verifyStaleness.cjs` generalise `costs.py`'s
`{asOf, days, stale, warning}` vocabulary into JS, adopted additively by two consumers.

The two suites **guard each other**: the invariant suite asserts the tripwire exists, is non-empty
and is wired into `package.json`'s `verify` chain; the tripwire asserts the same of the invariant
suite and additionally that its seventeen row ids and its `--self-test` branch are still there. That
mutual attestation is the answer to "prove the tripwire cannot be disabled by the self-build path",
and it is argued route by route in §6.

Everything is core Node only. No dependency is added. Nothing existing is removed or renamed; the 22
current suites and their 1,970 assertions keep running byte-identically.

---

## Technology stack — locked once this design is approved

| Concern | Choice | Why not the alternative |
|---|---|---|
| Language / runtime | CommonJS `.cjs` on the installed Node, run as `node scripts/<file>.cjs` | `scripts/verify*` is **21 files: 14 `.cjs` and 7 `.mjs`** (measured). The `.mjs` ones are renderer-math suites; these three read `electron/` modules, which are CJS |
| Source analysis | **hand-rolled single-pass character scanner** inside `verifyInvariants.cjs` | `@babel/parser` 7.29.7 is a *devDependency*. It resolves in this worktree only because Node walks up to `Rama_AGI/node_modules` (§1, measured) — using it would make the suite depend on an accident of directory layout and break in a clean clone. No new dependency; none needed |
| Hashing | `crypto.createHash('sha256')` | Core Node. Already the project's integrity primitive (`updateChannel`, `selfRepair`) |
| Electron absence | unconditional `Module._resolveFilename` patch + `require.cache` stub, the pattern at `scripts/verifyEngineDiagnosis.cjs:29-37`, extended with `app.getPath` | Not invented here (R1.7). Must be **unconditional** — decision D2. `getPath` is the extension, and it is *not* on its own a proof of isolation — D2 and I16's two-sided probe are (finding 1) |
| Temp artefacts | `os.tmpdir()` + `fs.rmSync(..., {recursive:true, force:true})` | NFR5. The repository working tree is never written |
| Clock | injected (`{now}` parameter), the `popoutGrant.useClock` / `refreshScheduler.status({now})` pattern | NFR2 |
| Reporter | `console.log` `PASS`/`FAIL` with counters and `process.exit(fail ? 1 : 0)` | The convention all 22 suites use. `process.exit` is **required**, not stylistic: `dataStore.loadAll()` starts a 60 s auto-save `setInterval` (`dataStore.cjs:startAutoSave`), measured to keep the event loop alive until killed |

No dependency is added anywhere in this design. If a later change believes one is unavoidable, it is
a separate decision for master with a pinned version — not a side effect of this tranche.

---

## 1. Environment, measured

```
Test-Path .worktrees/model-eval/node_modules        False
Test-Path Rama_AGI/node_modules                     True    (incl. electron, @babel/parser, argon2)
node -e "console.log(typeof require('electron'))"   string      ; require('electron').app → undefined
node scripts/auditRenderer.cjs                      exit 0, 2.51 s, 139 bridge calls, 365 IPC channels, 76 files
git status --porcelain                              clean apart from untracked .agents/ and docs/research/
```

The worktree sits at `Rama_AGI/.worktrees/model-eval`, so Node's resolution walks up and finds the
**main workspace's** `node_modules`. Three consequences, two of which changed since the first
iteration:

1. **`require('electron')` succeeds and returns a string** (measured above). So
   `electron/nucleusSealer.cjs`'s module-scope `const { app } = require('electron')` does not throw
   here — it quietly yields `app === undefined` and fails later inside `baseDir()` with a confusing
   `TypeError`. The stub is therefore installed **unconditionally and before the first target
   require**, never as a `catch` fallback (D2).
2. **Anything reached inside `node_modules` would pass here and fail in a clean clone.** The suite
   asserts its own purity in preflight P3, with one bounded, named exception (point 3).
3. **The KDF has a fallback, so the behavioural rows are environment-independent.**
   `electron/cryptoCore.cjs:76-97` is `try { require('argon2') … } catch { crypto.pbkdf2(password,
   salt, 600000, KEY_BYTES, 'sha512', …) }`, and `authCore.cjs:72` is
   `function argon2() { try { return require('argon2'); } catch { return null; } }` with a scrypt
   branch. `unlock` therefore works with or without the native module. **The first iteration's
   decision D6 was built on the opposite belief and is withdrawn** (§2, D6; §14, H1).

### Measured cost of the behavioural rows (NFR3)

Run with the stub in effect, `app.getPath('userData')` pointed at a fresh temp directory, argon2
resolvable (Argon2id, 128 MiB, 4 iterations, 2 lanes — `cryptoCore.cjs:41-43`):

| Operation | Wall clock | Note |
|---|---|---|
| `init(dataDir)` + `masterUnlock('a-long-master-passcode', dataDir, 'ua')`, first run | **776 ms** | one derivation, plus a nucleus seal from template into the temp dir |
| `changePasscode('wrong-one', 'a-long-enough-new-passcode')` after that unlock | **427 ms** | two derivations — the proof plus the restore (H4) |
| `lock()` → `unlock('wrong-passcode')` → `verifyPasscode` → `hasVerifier` | **210 ms** | one derivation |
| KDF-bearing total | **1.41 s** | |
| whole measurement process, module loads included | **2.19 s** | |
| `node scripts/auditRenderer.cjs` child spawn (I7) | **2.51 s** | existing suite, unchanged |

So the projected cost of `node scripts/verifyInvariants.cjs` is **≈ 5 s** — the 1.41 s of KDF work,
the 2.51 s child spawn, and the tree scan — inside NFR3's 10 s with room, and the figure is recorded
rather than asserted. Two rules keep it there, and D3 states them as code-level invariants of `ctx`: the
KDF work is performed **once** by a memoised `kdfFixture(ctx)` shared by I1, I3 and I14 (§4), and under a
non-empty overlay `kdfFixture` returns `null` and the KDF-bearing halves do not run at all — so
`--self-test` multiplies only cheap source-shape work and can never serve a stale memo (finding 11).

Simultaneously measured, and load-bearing for P3: after those rows the `require.cache` holds exactly
three `node_modules` packages — **`argon2`, `@phc/format`, `node-gyp-build`** — argon2 and its own
dependency closure. P3's allowance is those three names and nothing else.

---

## 2. Decisions

### D1 — One source scanner, three views, offsets preserved

`verifyInvariants.cjs` carries a private scanner. Two measured facts make it mandatory rather than
nice-to-have:

- `console\.log` across `electron/ server/ shared/ src/` returns **4 raw hits**, every one a comment
  or a string literal: `astEngine.cjs:101` (comment), `astEngine.cjs:106` (inside the string
  `'console.log in code — remove before production'`), `safeRequire.cjs:140` (comment),
  `verifyProposal.cjs:8` (comment). On the `code` view there are **zero**.
- `require('http'|'https')` returns **4 raw hits**: `http.cjs:23`, `http.cjs:24`,
  `selfRepair.cjs:45`, and `main.cjs:384`, which is **inside a comment**. On the `code` view there
  are **three**, all accounted for by `HTTP_ALLOWED`.

A naive matcher is red on a clean tree, which is the same as having no check.

The existing one-liner (`verifyClaimGate.cjs:262`, `verifyModelRoles.cjs:224`:
`src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')`) is not enough: it does not blank string literals, it
corrupts `http://` inside a string, and it mangles regex literals containing `//`. It is left
untouched where it is; the new scanner is a strict superset.

`scan(source)` is a single left-to-right pass tracking one state at a time: normal, line comment,
block comment, single-quoted, double-quoted, template (with `${…}` depth counting, re-entering normal
state inside the substitution), and regex literal. A `/` opens a regex only when the previous
significant character is one of `(,=:[!&|?{};+-*%~^` or the source is at a statement start —
otherwise it is division. Backslash escapes are consumed as a pair in every string and regex state.
It returns three **equal-length** strings:

- `code` — comments, string bodies, template bodies and regex bodies replaced by spaces; delimiters
  kept; newlines preserved.
- `comments` — the inverse: only comment text survives, everything else is spaces.
- `raw` — the original.

**Blanked, not deleted**, so every offset and line number is identical across the three views. That
is load-bearing twice: failure messages report a true line number, and the I17 row reads *string
literals inside a known function's span*, which is only possible if a span found in `code` indexes
correctly into `raw`.

Rule applied consistently, and asserted by the scanner's own fixture block: **absence is proved on
`code`; presence of a literal is proved on `raw` inside a span located in `code`; comment-only
properties are proved on `comments`.**

### D1a — The extractor set, named with signatures (resolves M13)

Every row below uses only these. Each takes the view it needs explicitly, so no row can silently
assert on the wrong one.

| Extractor | Signature | View | Used by |
|---|---|---|---|
| `functionBody` | `(code, name) → {start,end} \| null` — the `{…}` of `function name(`, `name(…) {`, or `const name = (…) => {`, by brace counting | `code` | most rows |
| `blockAfter` | `(code, offset) → {start,end}` — the next `{…}` block at or after `offset` | `code` | I3 (the `else if` branch), I17 (`run:` bodies) |
| `callsWithin` | `(code, span, callee) → number` — count of `callee(` inside the span | `code` | I3, I14, I15, I17 |
| `orderWithin` | `(code, span, tokens[]) → number[]` — **first** offset of each token, `-1` when absent | `code` | I14 |
| `returnLiterals` | `(code, span) → Array<{offset, keys:string[]}>` — keys of each `return {…}` object literal in the span | `code` | I1 |
| `exportedNames` | `(code, span) → string[]` — the module's export surface in **all three** forms this tree uses: member names of a `module.exports = {…}` (shorthand and `k: v` alike), each `module.exports.<name> =` assignment, and a bare `module.exports = <ident>` reported as `default:<ident>` | `code` | I2, I11, I15, I16 |
| `stringLiteralsIn` | `(raw, code, span) → string[]` — the literal bodies whose delimiters lie inside the span | span from `code`, text from `raw` | I2 |
| `keyedStringLiterals` | `(raw, code, span, key) → string[]` — only the literals whose immediately preceding significant tokens in `code` are `key` then `:`; the body is read from `raw` | span from `code`, text from `raw` | I17 |
| `catchBodies` | `(code) → Array<{start,end}>` — every `catch (…) {…}` / `catch {…}` block | `code` | I11 |
| `requireSites` | `(raw, code) → Array<{offset, line, module, binding, topLevel}>` — one entry per `require(` whose argument is a literal; `module` read from `raw`, `binding` from the enclosing declaration or assignment, `topLevel` true when brace depth is 0 | both | I8, I9, I11 |
| `walkShipped` | `(ctx) → Array<{rel, raw, code, comments}>` — every file under `SHIPPED_DIRS` with a code extension, **read through `ctx.read`** so the overlay applies | all three | I8, I9, I10, I11, I12 |

`walkShipped` reading through `ctx.read` is not a detail: without it the tree-wide rows would have no
planted-breach path, which is the defect D3 exists to fix.

**`exportedNames` must handle all three export forms** (resolves finding 9). Measured: every module the
rows touch uses `module.exports = {` — `electron/nucleusSealer.cjs:583`, `electron/cryptoCore.cjs:305`,
`electron/sessionManager.cjs:342`, `electron/lib/loyaltyCore.cjs:375`,
`electron/lib/startupDoctor.cjs:301` — **except `server/routes/auth.cjs`**, which is
`module.exports = router;` (`:111`) followed by `module.exports.requireLocalToken`, `.TIERS`, `.can`
(`:112-114`). An object-literal-only extractor returns nothing there, and a row whose extractor returns
nothing must fail (R1.6), so I2 would have been red on HEAD for the wrong reason. The three-form
extractor is therefore a requirement of the row, not a generalisation for its own sake.

**`keyedStringLiterals` exists because an unkeyed extractor cannot express I17's set equality** (resolves
finding 8). Measured: `registerRefresh`'s span also contains `'models.add-key'`, `'self-whatever'`-class
capability names, `'./lib/http.cjs'`, `'./lib/ollamaLibrary.cjs'` and both `label:` strings, so
"the literals in this span equal `{ollama-catalog, dependency-review}`" is **false on HEAD**. I17 keys on
`name` and additionally narrows the span to each `sched.register(` call's own block (§4, I17).

A row whose `functionBody` returns `null` **fails**, naming the function it could not find. A renamed
enforcement point is exactly the failure mode being guarded, so "not found" is never benign (R1.6).

**Every row's `files` entries are repo-relative paths, never basenames** (resolves finding 21).
Measured, because the tree is not flat: `electron/sessionManager.cjs`, `electron/cryptoCore.cjs`,
`electron/dataStore.cjs`, `electron/main.cjs`, `electron/nucleusSealer.cjs`,
`electron/resourceOrchestrator.cjs` sit at `electron/`, while `authCore.cjs`, `proposals.cjs`,
`loyaltyGuard.cjs`, `loyaltyCore.cjs`, `capability.cjs`, `releaseChannel.cjs`, `refreshScheduler.cjs`,
`ollamaCatalog.cjs`, `startupDoctor.cjs`, `http.cjs` and `modelRoles.cjs` sit at `electron/lib/`. All 23
paths named by the rows were confirmed present at `8c1c9ee`. Preflight P5 is only writable against
repo-relative entries, and `ctx.read(rel)` takes the same form, so the two agree by construction. Where
§4's prose names a file by basename for readability, the row's `files` array carries the full path.

### D2 — The Electron stub is unconditional, and it is also the isolation boundary

```js
const realResolve = Module._resolveFilename;
Module._resolveFilename = (request, ...rest) =>
  request === 'electron' ? 'electron-stub' : realResolve.call(Module, request, ...rest);
require.cache['electron-stub'] = { id:'electron-stub', filename:'electron-stub', loaded:true,
  exports: { app: { getPath: () => ctx.homeDir, getAppPath: () => ctx.root },
             BrowserWindow: { getAllWindows: () => [] },
             ipcMain: { handle(ch, fn){ ctx.handlers.set(ch, fn); }, on(){} } } };
```

Installed before the first target require and restored in a `finally`. `app.getPath` returns a
per-run temp directory, and that is what makes two things safe rather than merely convenient:

- `dataStore.getDataDir()` is `app?.getPath('userData') || os.homedir()/.rama-agi` **evaluated at call
  time** (`dataStore.cjs:32-35`), so the store the behavioural rows open is `ctx.homeDir/data`.
  Measured: `C:\…\Temp\rama-kdf-*\home\data`, and `masterUnlock`'s first-run path sealed a nucleus
  there, not in master's real profile.
- `loyaltyCore.baseDir()` has a **similar but weaker** shape (`loyaltyCore.cjs:82-87`, measured):
  `require('electron').app?.getPath('userData') ?? null` **falling back to
  `path.join(os.homedir(), '.rama-agi')`**, with `corePath() = baseDir()/.loyalty.enc` (`:88`). So the
  stub makes the seal land in temp *when it is in effect*, and an absence of a core says nothing about
  where `baseDir()` resolved — on a machine that never sealed a core in `~/.rama-agi`, `present` is
  `false` there too. That is why the I16 row does not infer isolation from an absence: it **writes a
  probe into `ctx.homeDir` and requires `describe().present` to flip `true` then `false`** before it
  seals anything (§4, I16; finding 1).

`ipcMain` is a recorder, so the I17 row can invoke `releaseChannel`'s registered `release:cut`
handler directly.

### D3 — Overlay with a rebase rule, not a tree copy (resolves H3)

A planted-breach test must run a row against a *mutated* file while every sibling that file requires
still resolves. Copying `electron/ shared/ server/ src/` per mutation would blow NFR3 and would need
Windows symlink privilege to avoid.

The first iteration mapped "sibling requests whose resolved path equals an overlay key", which cannot
work: a relative request issued from a file under `ctx.tmp` resolves *under `ctx.tmp`*, where nothing
exists, so resolution throws `MODULE_NOT_FOUND` before any mapping applies. Measured relative
requires that would hit this: `loyaltyCore.cjs` → `./loyaltyGuard.cjs` (4 sites), `proposals.cjs` →
`./capability.cjs` and `./loyaltyGuard.cjs`. The rule is therefore a **rebase**:

```js
const underTmp  = f => f && norm(f).startsWith(norm(ctx.tmp) + '/');
const relOf     = (f, base) => norm(path.relative(base, f));
const isRelative = r => r.startsWith('./') || r.startsWith('../');

Module._resolveFilename = function patched(request, parent, ...rest) {
  if (request === 'electron') return 'electron-stub';
  let p = parent;
  if (isRelative(request) && underTmp(parent?.filename)) {
    // The mutated copy stands in for a repo file: resolve its siblings as the
    // repo file would have, then prefer an overlay copy if one exists.
    const repoFile = path.join(ctx.root, relOf(parent.filename, ctx.tmp));
    p = new Module(repoFile);
    p.filename = repoFile;
    p.paths = Module._nodeModulePaths(path.dirname(repoFile));
  }
  const resolved = realResolve.call(this, request, p, ...rest);
  const rel = relOf(resolved, ctx.root);
  return (!rel.startsWith('..') && ctx.overlay.has(rel)) ? ctx.materialise(rel) : resolved;
};
```

- `ctx.overlay` is a `Map<repoRelativePath, string>` of mutated bodies; `ctx.read(rel)` returns the
  overlay body when present, else `fs.readFileSync`. Every source-shape row reads **only** through
  `ctx.read`.
- `ctx.materialise(rel)` writes the overlay body to `ctx.tmp/<rel>` once (parent dirs created) and
  returns that path. Because the returned filename lies under `ctx.tmp`, its own relative requires
  come back through the rebase branch, so a chain of mutated modules resolves correctly.
- Before and after each `--self-test` row, every `require.cache` key under `ctx.root` or `ctx.tmp` is
  deleted, so the mutated copy is genuinely loaded rather than served from cache.
- **The overlay and the memoised KDF fixture are reconciled by one rule** (resolves finding 11).
  `ctx.setOverlay(map)` is the only way to change the overlay, and it does three things: it replaces
  `ctx.overlay`, it purges the cache as above, and it **sets `ctx.kdf = null`** — because the memo holds
  module instances and an unlocked store belonging to objects that are no longer in the cache, and a
  stale memo would throw and read as a failure for the wrong reason. The second half of the rule:
  **when `ctx.overlay` is non-empty, no row runs a KDF-bearing behavioural half.** `kdfFixture(ctx)`
  returns `null` under a non-empty overlay, and I1, I3 and I14 then take their verdict from their
  source-shape halves alone — which is sound, because every planted mutation for those three rows is a
  source-level weakening their source-shape half is written to catch (verified per row in §4). A normal
  run has an empty overlay, so it derives once and runs both halves. I16 is the one row whose
  behavioural half *does* run under an overlay; its KDF is `loyaltyCore`'s own 4096-round PBKDF2, not
  `cryptoCore`'s argon2/600 000-round derivation, so it is cheap enough to repeat and the row cleans up
  after itself (§4, I16).
- Normal runs have an empty overlay, so `read`/`load` degrade to plain `readFileSync`/`require` — the
  same code path, which is why the overlay cannot drift from the real run.

**Self-test fixture S1** proves the rebase rather than assuming it: mutate
`electron/lib/loyaltyCore.cjs` with a harmless marker, load it through `ctx.load`, and assert (a) the
load succeeded, (b) `require.cache` holds `ctx.tmp/electron/lib/loyaltyCore.cjs`, and (c) the
`loyaltyGuard.cjs` entry it pulled in resolves **under `ctx.root`**, not under `ctx.tmp`. If S1 fails
the suite exits non-zero before any row claims a planted breach was detected.

The working tree is never written. AC2's `git status --porcelain` assertion holds by construction, and
the suite re-asserts it: after `--self-test`, it verifies no path it wrote lies under `ctx.root`.

### D4 — Rows are data, so "exactly 17" is structural

```js
const ROW_IDS = Object.freeze(['I1','I2','I3','I4','I5','I6','I7','I8','I9','I10',
                              'I11','I12','I13','I14','I15','I16','I17']);
const ROWS = [ { id:'I1', kind:'behavioural+source-shape', title:'…',
                 files:['electron/sessionManager.cjs'],            // repo-relative, always
                 run(ctx){ return { ok, detail } },
                 mutations:[ { name:'…', file:'electron/sessionManager.cjs',
                               mutate(src){ return src.replace(…) } } ] }, … ];
```

The runner asserts, before executing anything, that `ROWS.map(r => r.id)` equals `ROW_IDS` exactly —
same length, same order, no duplicates. A row deleted to make the suite green fails the suite itself,
which is AC1's non-vacuity condition expressed as code rather than as a count printed at the end.
Three counters: `passed`, `failed`, `declared`. `declared` holds I13 only, printed as
`17 rows: 16 asserted, 1 declared un-assertable`. Exit is non-zero if `failed > 0`, if the id list
check fails, or if `passed + failed + declared !== 17`.

Labels carry the strength: `PASS  I2  [source-shape] …`, `PASS  I15  [behavioural+structural] …`,
`PASS  I11  [source-shape, PARTIAL — covers n of m] …`, `UNASSERTABLE  I13  …`. A weaker assertion is
visible in the output rather than implied (R1.2).

`ROW_IDS` is also what the tripwire checks structurally (D8), so deleting a row id breaks two suites.

### D5 — Every mutation must be *semantic*, not cosmetic

A mutation that only deletes a line proves the row reads that line, not that the row understands the
invariant. Each mutation below is a plausible *weakening* someone would actually write: a renamed
guard, an `if (false)`, a swapped ordering, an extra export, a demoted tier, a deleted term check.
The self-test asserts the row goes red; it also asserts the row goes **green again** when the overlay
is cleared, so a row that is unconditionally red cannot pass the self-test.

### D6 — WITHDRAWN

The first iteration made `argon2` availability decide which half of I1, I3 and I14 bore the verdict,
and raised the resulting partial to master. The premise was wrong: both `cryptoCore` and `authCore`
fall back to PBKDF2/scrypt (§1, point 3), so the behavioural halves run everywhere. **D6 is deleted.
The behavioural halves run unconditionally and the source-shape halves run as independent assertions
in their own right** — they catch renames a behavioural call cannot. No row carries an environment
clause, and §12 no longer raises a partial that does not exist. What replaces it is the measured cost
in §1 and the shared `kdfFixture`.

### D7 — The three suites are **appended** to the `verify` chain, and a `verify:covenant` alias gives the loyalty gate on its own

`package.json`'s `verify` is a 23-link `&&` chain (measured: 22 suites plus `auditRenderer.cjs`), so it
short-circuits at the first failure. The first iteration **prepended** the two new suites so a covenant
breach would be the first thing master sees. The review's NIT 19 is right that this trades one silence
for another: prepending means a bug in the new suites makes all 22 existing suites go quiet, which is the
exact failure mode ledger row 118 recorded and AC20 guards, and R1.8 says *appended*.

**Resolution: follow R1.8.** The requirements win over a design preference, and the ordering question
goes to master as a one-line decision (§12 item 12) rather than being settled here by reordering 22
suites that master did not ask to have reordered.

```
"verify:invariants": "node scripts/verifyInvariants.cjs",
"verify:tripwire":   "node scripts/verifyLoyaltyTripwire.cjs",
"verify:staleness":  "node scripts/verifyStaleness.cjs",
"verify:covenant":   "node scripts/verifyLoyaltyTripwire.cjs && node scripts/verifyInvariants.cjs",
"verify": "<the existing 23 links, unchanged, in order> && node scripts/verifyInvariants.cjs && node scripts/verifyLoyaltyTripwire.cjs && node scripts/verifyStaleness.cjs"
```

Four consequences, stated so neither ordering is believed to be free:

- **Nothing is removed or reordered** (I11): the 23 existing links keep their text and their position,
  so no existing suite can go quiet because of this tranche.
- **The loyalty gate is still one command.** `npm run verify:covenant` runs the tripwire then the
  invariant suite — sub-second plus ≈5 s, no engine, no network — so master never has to run 22 chart and
  math suites to learn whether the covenant files moved. The tripwire goes first inside that alias
  because its verdict is cheaper and narrower.
- **Packaging does not depend on chain position at all.** `scripts/beforeBuild.cjs` calls the tripwire
  directly and throws (§5), so an unapproved covenant change cannot be packaged even if `verify` is
  never run.
- **The residual is honest:** in `npm run verify`, a failure in an unrelated existing suite now
  short-circuits before the covenant verdict is reached. That is a reporting delay, not a gate hole —
  `verify` still exits non-zero, and `verify:covenant` and `beforeBuild` both reach the verdict
  unconditionally.

`verify:staleness` goes last within the appended group: it is the only link depending on this tranche's
new `electron/lib/staleness.cjs`, so a failure there must not mask a loyalty failure.

`npm run verify` is this tranche's definition of "fails the build" (requirements assumption 1).
`start.cjs` stage 1 wiring stays deferred: a boot that halts on a failed invariant has no fallback,
which is an I11 question for master.

### D8 — The invariant suite is guarded **structurally**; digests are reserved for the covenant (resolves M11)

R2.1's guarded set is the three loyalty files, `capabilities.json`'s tier-0 entries, and the
approvals file. The first iteration added both new suites by digest. For the tripwire that is right —
a guard that does not guard itself can be edited into a no-op. For `verifyInvariants.cjs` it is
wrong, and the reason is maintenance: the invariant suite is *meant* to grow. R-L3 will add nine
`PROTECTED_FILES` entries, a new spawn site needs a `SPAWN_SITES` classification, a third
`KNOWN_MARKERS` entry is an honest edit. Under a digest, every one of those needs a master approval
whose `ledgerRef` resolves inside Section 28 — friction that pushes a maintainer towards *not*
extending the suite, which is the opposite of what this tranche is for.

So the tripwire guards `scripts/verifyInvariants.cjs` by **structure**: the file exists, is
non-empty, names all seventeen ids of `ROW_IDS`, contains the `--self-test` branch, and is present in
`package.json`'s `verify` chain. The residual is stated plainly: a row's *contents* can be weakened
without an approval. Two things narrow it — `--self-test` turns a weakened row red whenever it is
run, and the weakening is a visible diff in a file whose entire purpose is to be read. Closing it
fully would mean digesting the suite, and that trade was taken the other way deliberately.

The tripwire itself keeps its own digest, with the consequence accepted: **fixing a bug in the
tripwire requires an approval record.** It is a 300-line file with no feature surface, so it should
rarely change, and when it does, a record is appropriate. Flagged in §12 so master sees the friction
before meeting it.

### D9 — `--record-baseline --force` may only re-record digests that already validate (resolves H6)

`--force` as first designed was a bypass: re-record every digest including a tampered
`loyaltyGuard.cjs`, and `npm run verify` is green with no approval anywhere. Printing before/after
digests during the run that performs the change is not a refusal.

| Situation | Behaviour |
|---|---|
| no baseline file exists | **record** every digest, print each one, print `BOOTSTRAP — this baseline is only as trustworthy as the commit that introduces it`. `--force` is not needed and is ignored |
| baseline exists, no `--force` | **refuse**: `a baseline already exists; pass --force to replace it` |
| baseline exists, `--force`, every member either unchanged or changed-with-a-valid-approval | **record**, printing before/after for each changed member |
| baseline exists, `--force`, any member changed **without** a valid approval | **refuse, write nothing**: `<path> changed and no approval names <digest>; an approval entry is the only way forward`. Exit 1 |

The write is all-or-nothing — a temp file in `.rama/` renamed into place — so a partial baseline
cannot exist. This is the fourth of §6.3's five obstacles, and the subject of AC-T6 (§5).

### D10 — Counted baselines where universal coverage would be a lie

Three invariants are not true today as universals: I10 (not every spawn path consults `admit`), I11
(not every optional dependency is required behind a guard), I12(c) (two real marker breaches exist).
A row asserting the universal would be **red on HEAD**, and a row asserting nothing would be
decoration. Each of those rows therefore carries a **frozen, measured inventory**: green on HEAD,
printed on every run so the gap is never invisible, red the moment the inventory and the tree
disagree in either direction. The pattern is the same in all three, which is why it is a decision
rather than three local hacks, and in all three the *closing* of the gap is master's call (§12), not
this tranche's.

### D11 — `capabilities.json` is guarded by a canonical tier-0 projection, not by whole-file digest

R2.1 names "the **tier-0 entries** of `shared/capabilities.json`". A whole-file digest exceeds that:
adding a tier-4 capability would demand a covenant-class approval. The baseline therefore records:

- `tier0` — the sorted `name:tier` pairs of every capability whose tier is `0`. Measured: **29 of 77**
  (`identity.reveal`, `identity.voice-wake`, `identity.master-address`, `chat.unrestricted`,
  `agents.governor-config`, `os.filesystem-delete`, `terminal.unrestricted`, `sandbox.approve`,
  `git.force`, `release.cut`, `browser.accounts`, `system.self-update`, `vault.read`, `vault.write`,
  `vault.unlock`, `self-modify.apply`, `users.create`, `users.edit`, `users.delete`, `mind.view`,
  `mind.edit`, `mind.proactive`, `apps.execute-all`, `genome.view`, `genome.propose`,
  `instances.express`, `meta.view`, `meta.audit`, `timeline.restore`) — derived at run time, never
  hardcoded;
- `ladder` — the whole `tiers` object (measured: `MASTER 0 … GUEST 5`) and `tierLabels`' key set;
- `projectionSha256` — sha256 over the canonical JSON of `{tier0, ladder}`;
- `fileSha256` — advisory only, reported when it changes so no edit is invisible.

Verdicts: a tier-0 member removed, or its tier moved off `0`, **fails** naming the capability and
both tiers; any change to the ladder **fails**; a capability promoted **to** tier 0 is a tightening —
**passes, reported**, and enters the baseline only through `--record-baseline` (R2.3); a change
touching neither **passes** with a `NOTE` that the file changed outside the guarded projection.
An approval entry for `shared/capabilities.json` carries the **projection** digest, so it binds to
exact guarded content without being invalidated by an unrelated capability addition.

---

## 3. `scripts/verifyInvariants.cjs` — structure

```
scripts/verifyInvariants.cjs
├── header            why an invariant with no assertion is the ledger-row-48 drift class,
│                     and the three categories in which a covenant token may appear here (N4)
├── scan()            the three-view scanner                                          (D1)
├── extractors        functionBody, blockAfter, callsWithin, orderWithin, returnLiterals,
│                     exportedNames, stringLiteralsIn, keyedStringLiterals, catchBodies,
│                     requireSites, walkShipped                                        (D1a)
├── scannerFixture()  the scanner's own assertions, run before the rows
├── stubElectron() / restoreElectron()                                                (D2)
├── makeCtx()         root, tmp, homeDir, overlay, read, load, materialise, handlers, spawnNode (D3)
├── kdfFixture(ctx)   one memoised init+masterUnlock, shared by I1, I3, I14            (§1)
├── PREFLIGHT[]       P1–P6, printed before the rows, failing the suite on breach
├── ROW_IDS / ROWS[]  I1 … I17, declarative                                           (D4)
├── runRows(ctx)
├── selfTest()        S1 (the overlay itself) then per-row planted mutations           (D3/D5)
└── main()            arg parse (--self-test), report, process.exit
```

The suite's header states the **three** categories in which a token such as `loyaltyPriority` or
`COVENANT.master` may legitimately appear in this file, so AC3's grep has a written answer (N4):

1. as a **forbidden token being searched for** (I16's deep-walk key list);
2. as an **expected violation message** to match (`/master must remain/`, `/loyaltyPriority must begin
   with/`) — a pattern the suite searches *for* in a thrown message, which is AC3's category read in the
   direction it was written;
3. as a **mutation target composed from parts** — I15's mutation (b) must locate the check it
   deletes, and writes the pattern as `'l.master !== COVENANT' + '.master'` so no complete reference
   to a covenant field appears as a single literal.

**Fixture data is not a fourth category; it is written so the token never appears whole** (resolves
finding 5). I15's `CONFORMING` object and its per-term mutation inputs need a `loyaltyPriority` *key*,
which would be an occurrence in none of the three roles above and outside AC3's wording. Rather than
widen AC3, the key is **composed**: `{ ['loyalty' + 'Priority']: ['master', 'ethical_core',
'third_parties'] }`. A computed key yields the identical property name, `guard.inspect` sees no
difference, and `Select-String -Pattern "loyaltyPriority"` finds only categories 1 and 2. The same
composition is used for the mutation input that reorders the priority list. The alternative — deriving
`CONFORMING` from `COVENANT` — is rejected for the reason H5 established: one mutation would then move
both sides of the comparison and the row would pass for the wrong reason.

No category reads a matrix value, and category 3 exists only inside `--self-test`.

### The scanner's own fixture, run before any row

A synthetic file containing: `// console.log in a comment`, `'console.log in a string'`,
`` `a ${b + `${c}`} template` ``, `/\/\/ not a comment/`, `a / b / c` division, `require('http')`
inside a comment, and `'TODO in a string'`. Asserted: `code` contains no `console.log`, no `TODO` and
no `require('http')`; `comments` contains the first and not the second; all three views have identical
length; and the line number of a token in `code` equals its line number in `raw`. If the fixture
fails, the suite exits 1 before the rows — a broken scanner would otherwise make every absence
assertion vacuously green.

### Preflight — reported separately, never counted as invariant rows

| # | Check | Failing case |
|---|---|---|
| P1 | `scripts/verifyLoyaltyTripwire.cjs` exists, is non-empty, and `package.json`'s `verify` chain contains the string `verifyLoyaltyTripwire.cjs` | the tripwire was deleted or unwired (§6) |
| P2 | `ROWS.map(r=>r.id)` equals `ROW_IDS` exactly (D4) | a row was deleted to make the suite green |
| P3 | after all rows have run, every `require.cache` key containing `node_modules` belongs to a package named in `CACHE_ALLOWED`; the run prints the package list and which KDF executed | the suite silently acquired a dependency (§1) |
| P4 | `SHIPPED_DIRS` is exactly `['electron','server','shared','src']`, each exists, `scripts` is **not** a member, and `walkShipped` returns ≥ `SCAN_FLOOR` files | I12's scope was narrowed to excuse a breach (NFR6) |
| P5 | every path named in any row's `files` exists, resolved as `path.join(ctx.root, rel)` — the entries are repo-relative, never basenames (finding 21) | a renamed or moved enforcement point reads as a missing file, not as a pass |
| P6 | `ctx.homeDir` is a directory under `ctx.tmp`, `ctx.tmp` is under `os.tmpdir()`, and `ctx.homeDir` is **empty** at suite start | the stub's `getPath` would otherwise point behavioural rows at master's real profile. P6 asserts where `ctx.homeDir` *is*; it cannot assert where `loyaltyCore.baseDir()` resolves, which is why I16 carries its own two-sided probe (finding 1) |

```js
const CACHE_ALLOWED = Object.freeze([
  { module: 'argon2',         reason: 'cryptoCore/authCore prefer it and fall back to PBKDF2/scrypt; '
      + 'a behavioural KDF row loads whichever is installed. The verdict never depends on it.' },
  { module: '@phc/format',    reason: "argon2's own dependency, pulled in by the require above" },
  { module: 'node-gyp-build', reason: "argon2's own dependency, pulled in by the require above" },
]);
```

Measured: those three and no others appear after a full behavioural run. P3 prints
`KDF: argon2id (argon2 loaded)` or `KDF: pbkdf2-sha512 (argon2 not resolvable)` by inspecting the
cache, so the run says which path it exercised instead of leaving it to be inferred.

`SCAN_FLOOR = 150`. Measured at `8c1c9ee`: **158 files** under the four directories, **156** with a
code extension (78 `.cjs`, 43 `.jsx`, 33 `.js`, 2 `.json`), 1 `.html` and 1 `.css` excluded. The floor
sits below the measurement with slack for honest deletions; its job is to catch a walk that was
quietly narrowed, which is NFR6's mechanism and the reason `scripts/` is pinned out of `SHIPPED_DIRS`
(all 22 suites use `console.log` as their reporter, and that exclusion must not later widen to
`electron/lib/`).

---

## 4. The seventeen rows — exactly what proves each enforcement point

Every row names the enforcement point as Section 28 states it, what is asserted and on which view, and
the planted mutation that must turn it red.

**Line numbers are documentation, never assertions** (resolves finding 12). The previous iteration claimed
every `file:line` was measured and got four wrong: the `authCore` tier floors are at `:307` (`provision`),
`:605` (`createUser`) and `:679` (`setUserTier`) — `:307`'s neighbours `:301`/`:602` are `pwCheck` and
`:675-676` are the not-found and master-immutable checks; the two scheduler tasks register at
`electron/main.cjs:551` and `:565`; the `release:cut` handler is at
`electron/lib/releaseChannel.cjs:198` (`:196` closes `release:state`); and the existing electron stub is
`scripts/verifyEngineDiagnosis.cjs:29-37`. All four are corrected below and were re-read line by line at
`8c1c9ee`. More importantly, **no row locates anything by line number**: every span comes from
`functionBody`, `blockAfter` or a bracket-matched declaration, so a stale number in this document is a
documentation slip and can never be a broken assertion.

### I1 — Gate 1 never returns a user or a token · `sessionManager.masterUnlock`

*Behavioural.* Through `kdfFixture(ctx)`: `init(dataDir)` then
`masterUnlock('a-long-master-passcode', dataDir, 'ua')` where `dataDir = dataStore.getDataDir()`
(= `ctx.homeDir/data` under the stub). Measured return: `{"ok":true,"storeUnlocked":true,"firstRun":true}`
— so the row asserts `Object.keys(result)` is a subset of `{ok, storeUnlocked, firstRun}` and that
`result.token` and `result.user` are `undefined`. The same call seals a nucleus from template, which is
why P6 exists.

*Source-shape, independently.* Within `functionBody(code('electron/sessionManager.cjs'),'masterUnlock')`:
`code` contains none of `\btoken\b`, `\buserId\b`, `\btier\b` — measured clean, because the body's only
mentions of those words are in comments (`// Deliberately no token and no user`), which `scan` blanks.
The row tests the code, not its own documentation. Additionally `returnLiterals` over the span may
only produce keys from `{ok, storeUnlocked, firstRun, error}`; a key outside that set fails naming it.

*Mutation.* Insert `token: 'x',` into the success return → **red on the source-shape half**, which is the
half that runs under an overlay (D3's rule: `kdfFixture` returns `null` when `ctx.overlay` is non-empty,
so the behavioural half is not run and cannot serve a stale memo — finding 11). `returnLiterals` sees the
added `token` key, and the `\btoken\b` ban in the span fires as well, so the mutation has two independent
witnesses on the half that is actually evaluated.
*What it catches.* A future session "helpfully" returning a session token from gate 1, collapsing three
gates into one — the regression Section 27 closed.

### I2 — The Express server has no authentication authority · `server/routes/auth.cjs`

*Source-shape.* On `code`: no `router.post(`, `router.put(`, `router.patch(`, `router.delete(`; no
`new Map(`; no `(const|let|var)\s+users\b`; no require of `jsonwebtoken|jwt|bcrypt|argon2|passport`.

*The shape this file actually uses* (resolves M7). Every auth route is registered through
`router.all(` inside two `for (const route of [ … ])` loops — `auth.cjs:85-86` for
`['/login','/login-step1','/login-step2','/logout','/me','/provision']` and `:90-91` for
`['/','/:id','/:id/suspend']` — and the only `router.get(` is `/tiers` at `:100`. A re-introduced login
route written the way this file already writes routes (`router.all('/login', handlerThatAuthenticates)`)
would keep a method-ban-only row green. So the row also asserts:

- `callsWithin(code, file, 'router.all')` **=== 2**, and each `router.all(` call's `blockAfter` body
  contains `status(501)`;
- exactly one `router.get(`, and its handler body is the only route handler in the file without
  `status(501)`;
- `stringLiteralsIn` over the two loop-array spans contains `/login` and `/provision`;
- `exportedNames` over the whole file equals exactly `{'default:router', 'requireLocalToken', 'TIERS',
  'can'}` — a new export here is a new authority. The form matters: this file is
  `module.exports = router;` (`:111`) plus three `module.exports.<name> =` assignments (`:112-114`), not
  an object literal, so the extractor must read assignment form and report the bare assignment as
  `default:<ident>` (D1a, finding 9). An extractor that returned nothing here would fail the row under
  R1.6 — red on HEAD for the wrong reason, which is worse than a missing assertion because it trains a
  maintainer to ignore the row.

*Why source-shape.* Booting Express needs `node_modules`; the row must hold in a clean clone
(requirements assumption 7). Labelled `[source-shape]`.

*Mutations.* (a) add `router.post('/login', (req,res)=>res.json({ok:true,token:'t'}))` → red on the
method ban; (b) rewrite one `router.all` handler to return `res.json({ok:true})` → red on the 501
assertion. Mutation (b) is the one that makes this row non-vacuous.
*What it catches.* Re-introduction of the hardcoded-master-password HTTP backdoor that ledger row 24
closed.

### I3 — A wrong passcode is rejected, never treated as first run · `cryptoCore.verifyPasscode`

*Behavioural.* Reusing `kdfFixture`'s dataDir, measured end to end: `cryptoCore.lock()`;
`await unlock('wrong-passcode', dataDir)`; then **`verifyPasscode(dataDir) === false` and
`hasVerifier(dataDir) === true`**. The second half is the real invariant — a wrong passcode must not be
able to re-enter the first-run branch — and both values were observed (210 ms).

*Source-shape, independently.* Within `masterUnlock`'s span: `!cryptoCore.hasVerifier(` appears exactly
once and is the condition guarding the `writeVerifier` branch; `cryptoCore.verifyPasscode(` appears
exactly once, inside an `else if (!…)`; `blockAfter` on that `else if` gives the branch body, which must
contain `cryptoCore.lock()` **and** a return carrying `ok: false`. The branch body is used rather than
the whole function because `cryptoCore.lock()` legitimately appears **twice** in `masterUnlock` — once
in the wrong-passcode branch and once in the outer `catch` — so a span-wide count would be a trap.
`orderWithin` asserts `hasVerifier` precedes `verifyPasscode`. Also: `cryptoCore.cjs`'s
`module.exports` lists both `hasVerifier` and `verifyPasscode`, because a renamed export is a silent
bypass.

*Mutation.* Rewrite the guard to `else if (false)` → red.
*What it catches.* Ledger row 25's defect: deriving keys always "succeeds", so without the verifier a
wrong passcode opens an empty store that looks like a fresh install.

### I4 — Master (tier 0) is provisioned once, never grantable · `authCore.provision`, `authCore.createUser`

**Two sub-cases, two adapters — because the two functions refuse at different depths** (resolves
finding 10). The first iteration used one all-throwing adapter for both, which makes the `setUserTier`
case red on HEAD for the wrong reason.

*(a) `createUser`, with an all-throwing adapter.* `setStorage` is exported (measured), so the row installs
an adapter whose every method throws `new Error('the store must not be reached')`. Then
`createUser({tier:0, userId:'a'}, {username:'validuser', password:'<clears checkPasswordStrength>',
tier:0})` → `{ok:false, error:/Master cannot be created/}`. Measured order inside `createUser`
(`electron/lib/authCore.cjs:595-610`): `!actor` → `checkUsername` → `checkPasswordStrength` → the tier
floor at `:605` → *then* the actor-level check and the store. So a valid username and a strong password are
**required inputs of the row**, or it would pass for the wrong reason, and the throwing adapter proves no
store was touched. Repeated for `tier: -1`, `'0'`, `0.0`, `null` — all five reduce to a refusal with the
same message (measured: `Tier must be 1–5. Master cannot be created.`).

*(b) `setUserTier`, with **both** accounts seeded.* Measured order (`:672-684`): `!actor` → `findById` →
`User not found` at `:675` → master-immutable at `:676` → the tier floor at `:679`. `findById` reaches
`requireStore().listUsers()`, so with only `m1` seeded the second sub-case gets `User not found` and never
reaches the floor. The adapter is written out:

```js
authCore.setStorage({
  listUsers: () => [{ userId:'m1', username:'m1', tier:0, isActive:true },
                    { userId:'u2', username:'u2', tier:3, isActive:true }],
  putUser() { throw new Error('the store must not be written'); },
  readMeta: () => ({}), writeMeta() {},
});
```

- `setUserTier({tier:0, userId:'m1'}, 'm1', 3)` → `/The master account is immutable/` (`:676`);
- `setUserTier({tier:0, userId:'m1'}, 'u2', 0)` → the tier floor at `:679`, and `putUser` was not called.

**The dash in that message is U+2013 EN DASH, not a hyphen** — the template is
`` `Tier must be ${TIERS.SUPERADMIN}–${TIERS.GUEST}` `` (measured `:680`), so the row writes
`/Tier must be 1\u20135/` explicitly. A hyphen-spelled regex would silently never match and the row would
be red on HEAD; this is the same class of defect as finding 10 and is pinned here so the implementer does
not retype it from memory.

*Source-shape.* `functionBody('provision')` contains `isProvisioned()` and that offset precedes every
`putUser(` in the span; the tier floors in `provision` (`:307`), `createUser` (`:605`) and
`setUserTier` (`:679`) are written `TIERS.SUPERADMIN` / `TIERS.GUEST` / `TIERS.VIEWER`, never bare
numerals — a numeric literal there would drift from `capabilities.json`; and **`tier = TIERS.MASTER`
occurs exactly once in the whole file** (measured `:323`), at an offset inside `provision`'s span,
inside the `opts.masterSecret` branch. That single-assignment assertion is what "provisioned once,
never grantable afterwards" reduces to mechanically. Each floor is located by `functionBody` and a search
within the span, so the three corrected line numbers are documentation only.

*Mutations.* (a) change `tier < TIERS.SUPERADMIN` to `tier < TIERS.MASTER` in `createUser` → red;
(b) add `tier = TIERS.MASTER` inside `setUserTier` → red on the single-assignment assertion.

### I5 — Access keys are HMAC-only, shown once, never reproducible · `authCore.mintKey`

*Behavioural, with a fully specified adapter* (resolves M5). `issueAccessKey` calls
`findById → allUsers → requireStore().listUsers()` and returns `{ok:false, error:'User not found'}`
when the user is absent (`authCore.cjs:241-252`), so capturing only `putUser` would make the row red
before it asserted anything:

```js
const seeded = { userId:'u1', username:'u1', tier:2, keyHash:null, keyExpiresAt:null, isActive:true };
let captured = null;
authCore.setStorage({ listUsers: () => [seeded], putUser: u => { captured = u; },
                      readMeta: () => ({}), writeMeta: () => {} });
const r1 = authCore.issueAccessKey('u1', 30);
```

Assertions:

- `r1.key` matches `/^\d{4}-\d{4}-\d{4}$/` and `r1.ok === true`;
- `Object.keys(captured)` ⊆ `RECORD_ALLOWLIST` = the seeded keys ∪ `{keyHash, keyExpiresAt, keyIssuedAt}`
  — the real record is `{...user, keyHash, keyExpiresAt, keyIssuedAt}` (`:249`), so the allowlist is
  written out rather than referred to;
- `captured.keyHash` matches `/^[0-9a-f]{64}$/`, and `JSON.stringify(captured)` contains neither
  `r1.key` nor its digits with the dashes removed;
- `createHmac('sha256', digits).update('u1').digest('hex') === captured.keyHash` — proving the stored
  value is a keyed digest **bound to one user**, not an encoding of the key;
- rotation, asserted without a validator: a second `issueAccessKey('u1', 30)` yields a different
  `key` **and** a different `keyHash`. `keyMatches` is internal and not exported (measured
  `:228-234`), so "the old key no longer validates" has no callable proof and the row does not pretend
  otherwise — only one hash is stored, which is the mechanism.

*Naming divergence, raised not fixed.* Section 28 names `authCore.mintKey`; `mintKey` exists at
`:218-227` but is **internal**, and the exported surface is `issueAccessKey`, `keygenAuthenticated`,
`keygenFromStepToken`, `keygenFromCredentials`. The row asserts the behaviour through the real exports
**and** that `functionBody('mintKey')` still exists and contains `createHmac('sha256', digits)`, so the
spec's name keeps meaning something. The spec is not edited (§12).

*Mutation.* Make `mintKey` return `hash: digits` → red on the HMAC assertion and on the
"record does not contain the returned string" assertion.

### I6 — Nothing is written to Rāma's own source without a recorded approval · `lib/proposals.cjs`

*Behavioural; `electron/lib/proposals.cjs` loads under plain Node (measured).* Refusals asserted at
`authorise`, which is the chokepoint (`electron/lib/proposals.cjs:41-51`).

**The two refusal branches were labelled the wrong way round, and asserting only "refused, naming I6"
made the mutation vacuous** (resolves finding 2 — the HIGH that would have failed AC2). Re-measured:
`approve(id, user)` takes the user as the **second positional argument** (`:176`), while `apply(id, opts)`
reads `opts.user` (`:219`). So `approve(id, 'master')` reaches the `typeof user === 'string'` branch and
`approve(id, {user:'master'})` reaches the `typeof user.tier !== 'number'` branch — the reverse of what the
first iteration wrote. And **both branches return `{ok:false}` with a message containing `I6`** (`:43`,
`:46`), so deleting the string branch leaves `'master'` falling through to the next branch
(`'master'.tier` is `undefined`), every listed case still refusing and still naming `I6`: the row stays
green and `--self-test` reports an undetected mutation.

The fix is to assert the **distinctive message per branch**, which is what makes the branch deletion
observable:

```js
expectMatch(approve(id, 'master').error,          /is a label, not an identity \(I6\)/);    // string branch, :43
expectMatch(approve(id, {user:'master'}).error,   /requires an authenticated user \(I6\)/); // no numeric tier, :46
expectMatch(approve(id, {name:'x'}).error,        /requires an authenticated user \(I6\)/); // same branch, no tier at all
expectMatch(approve(id, {tier:5,name:'g'}).error, /self-modify\.apply|not permitted/);      // capability.deny, :48
```

The full case list, each labelled by the branch it exercises:

- `create({kind:'self-modify', changes:[{action:'patch', path:'src/pages/Chat/Chat.jsx'}]})`, then
  `await apply(id, {user:{tier:0,name:'m'}})` → refused, because the status is `pending`. An approved
  proposal is a prerequisite, not a bearer token (`apply` authorises *then* checks status, `:216-228`);
- `approve(id, 'master')` → the **string branch** (`:42-44`): `/is a label, not an identity \(I6\)/`;
- `approve(id, {user:'master'})` → the **no-numeric-tier branch** (`:45-47`), because `{user:'master'}` is
  an object whose `.tier` is `undefined`: `/requires an authenticated user \(I6\)/`;
- `approve(id, {name:'x'})` → the same branch, same message;
- `approve(id, {tier:5,name:'g'})` → past both branches, refused by `capability.deny` on
  `self-modify.apply` (`tier` is numeric there, so the deny is genuinely reached);
- `apply(id, 'master')` → refused: `apply` reads `opts.user`, so a bare string yields `undefined` and lands
  on the no-numeric-tier branch. Applying carries the same authority as approving, and the row asserts the
  message rather than only the `ok:false`.

*Source-shape — appliers, asserted where a registration must be written* (resolves M10). `stats().appliers`
is `[]` in the suite's process regardless of the codebase, because appliers are registered by the
modules that own them and the row loads none of them. The assertion is therefore on source: across
`SHIPPED_DIRS` on `code`, the set of `registerApplier(` call sites equals this frozen baseline —

| Site | Kind registered |
|---|---|
| `electron/ipc/codeRegenEngine.cjs:205` | `ledger.KINDS.REGEN` |
| `electron/ipc/evolutionEngine.cjs:409` | `proposals.KINDS.EVOLUTION` |
| `electron/ipc/resourceResearchEngine.cjs:260` | `proposals.KINDS.RESOURCE` |
| `electron/ipc/timeline.cjs:195` | `ledger.KINDS.SELF_MODIFY` |
| `electron/lib/genomeApplier.cjs:110` | `ledger.KINDS.GENOME` |

— plus `registerApplier`'s single definition at `proposals.cjs:85`, and **no** registration naming
`KINDS.DEPENDENCY` or `'dependency'`. `KINDS.DEPENDENCY` exists (`proposals.cjs:59`) with no applier, so
the gap the evaluation flagged is real and now pinned: registering one later is red until a human
classifies it.

*Source-shape — the kind table.* `Object.keys(require('…/proposals.cjs').KINDS)` on a **fresh** require
equals `['EVOLUTION','REGEN','SELF_MODIFY','GENOME','DEPENDENCY']` exactly. Measured and raised in §12:
`KINDS` is **not** `Object.freeze`d, and `resourceResearchEngine.cjs:53` writes
`if (!proposals.KINDS.RESOURCE) proposals.KINDS.RESOURCE = 'resource';` at load — a sixth applier kind
added at run time by a consumer. The row asserts the exported table and names the run-time mutation on
every run rather than silently accepting it.

*Mutations.* (a) delete the `typeof user === 'string'` branch in `authorise` → red, because
`approve(id,'master')` then produces `/requires an authenticated user/` instead of
`/is a label, not an identity/` and the per-branch message assertion fires. **This is the mutation that was
vacuous before the per-branch messages were asserted**; (b) move `apply`'s status check above its
`authorise` call → red on the first case, which would otherwise let an unapproved proposal be refused for
the right reason by accident.

### I7 — Every page/route/tier/voice entry comes from the registry · `src/config/registry.js`

*Behavioural via the existing authority.* `spawnNode('scripts/auditRenderer.cjs')` must exit 0.
Measured here without `node_modules`: exit 0 in 2.51 s, 139 bridge calls, 365 IPC channels, 76 files
scope-checked. That suite stays the single definition of "resolves" (requirements assumption 5).

*Source-shape, in-process, overlay-aware.* `registry.js` is ESM importing `@services/accessControl.js`,
so it cannot be `require`d from CJS; the row parses it textually.

**"Entry" is defined by bracket matching, not by a whole-file field count** (resolves finding 7). The span
is the `[ … ]` of `export const PAGES = [`, found by scanning `code` for the declaration and
bracket-matching from the `[` (measured: declared at `src/config/registry.js:34`, the array closes at
`:197`). Entries are the top-level `{ … }` blocks inside that span — 18 of them, measured. Counting
whole-file occurrences would be wrong by one: **`route:` occurs 19 times**, because
`return { route: page.route, page };` at `:233` is real code and survives the `code` view, while the other
five fields occur 18 times. The row asserts **18 of each of the six fields inside the span**, and states in
its own output that occurrences outside the span are expected and ignored — a figure the first iteration got
wrong by counting the file rather than the array. Asserted:

- `route` and `id` unique across entries, non-empty, `route` starting with `/`;
- every `component` (`@pages/X/Y.jsx`) resolves to an existing file, with the alias read from
  `vite.config.js:21` (`'@pages': ./src/pages`), not hardcoded;
- every `minTier` written `TIERS.<NAME>` where `<NAME>` is a key of `shared/capabilities.json`'s
  `tiers` (measured `MASTER, SUPERADMIN, ADMIN, OPERATOR, VIEWER, GUEST`) — never a bare number;
- every entry carries a non-empty `voice` array and a non-empty `keys` array;
- the entry count equals the recorded baseline of **18**; a changed count fails naming the delta, so a
  page added without its voice/tier metadata cannot slip in.

*Mutation.* Point one `component` at `@pages/Nope/Nope.jsx` → red. The in-process half exists because a
child process cannot see the overlay; without it I7 would have no planted-breach test and AC2 would be
15 of 16.

### I8 — Tiers and the capability matrix are defined once · all three runtimes

*Source-shape.* The three consumers are asserted by their real wiring, which is not three direct reads:

| Runtime | File | Required shape |
|---|---|---|
| Electron main | `electron/lib/capability.cjs:15` | `require('../../shared/capabilities.json')`, exactly once |
| Renderer | `src/services/accessControl.js:21` | `import spec from '@shared/capabilities.json'`, exactly once |
| Express server | `server/routes/auth.cjs:35` | takes `TIERS`, `TIER_LABELS`, `can` **from `capability.cjs`** and re-exports `TIERS`/`can` (`:113-114`); no tier literal of its own |

The server reads the matrix *transitively*; asserting a direct require there would be false, so the row
asserts the delegation. (`:33` is the comment above it — N2.)

*No second tier table.* Across `SHIPPED_DIRS`: on `code`, no file other than `shared/capabilities.json`
may contain `/\bSUPERADMIN\s*:\s*1\b/` or `/\bMASTER\s*:\s*0\b/`; and on `raw`, the same two patterns
plus their quoted forms `/"MASTER"\s*:\s*0/` and `/"SUPERADMIN"\s*:\s*1/` are banned in every `.json`
file except `shared/capabilities.json` (N5 — string bodies are blanked in `code`, so a second table
written with quoted keys would otherwise be invisible). Measured clean on HEAD: every `SUPERADMIN` hit
is a `TIERS.SUPERADMIN` reference or a comment, never a definition.

*Mutation.* Plant `const TIERS = { MASTER: 0, SUPERADMIN: 1 };` into a copy of
`electron/lib/modelRoles.cjs` → red; plant `{"MASTER": 0}` into a copy of a `.json` under `shared/` →
red on the raw-view form.

### I9 — One main-process HTTP client; one renderer→server transport · `lib/http.cjs`, `apiClient.serverJson`

*Source-shape on `code`, with a declared exception list.* Across `electron/`, `server/`, `shared/`, no
`require('http'|'https'|'node:http'|'node:https')` outside:

```js
const HTTP_ALLOWED = Object.freeze([
  { file: 'electron/lib/http.cjs',       reason: 'this IS the one client (I9)' },
  { file: 'electron/lib/selfRepair.cjs', reason: 'declared exception: fetches one lockfile-pinned, '
      + 'sha512-verified tarball during repair, when lib/http.cjs may itself be the broken module' },
]);
```

Frozen in the suite with the reason inline, so the exception is documented at the point of enforcement
(R1.9); an entry without a reason string fails. Measured on HEAD: `code`-view hits are exactly
`http.cjs:23`, `http.cjs:24`, `selfRepair.cjs:45`, while `main.cjs:384`'s hit is **inside a comment** and
is blanked. This row is the primary proof that D1's scanner works (AC5).

*Renderer half.* Across `src/` on `code`: `\bfetch\s*\(` and `XMLHttpRequest` appear only in
`src/services/apiClient.js` — measured, exactly one hit, `:88`, and no `XMLHttpRequest` anywhere — and
`apiClient.js` exports `serverJson` (`:154`).

*Mutations.* (a) plant `require('https').get('http://x')` into a copy of `electron/lib/modelRoles.cjs`
→ red; (b) plant `fetch('/api/x')` into a copy of `src/services/ramaClient.js` → red.

### I10 — One resource admission authority · `resourceOrchestrator.admit`

**A recorded inventory, not a universal-coverage claim, because the universal is false today.** The
first iteration's inventory was wrong in four ways; everything below is re-measured with a detector
defined operationally so the measurement is reproducible (resolves H7).

*The detector.* A file is **spawn-bearing** when `requireSites` reports a require of
`child_process`, `node:child_process` or `node-pty`. Module name, not call shape — which excludes by
construction the two false positives that broke the first inventory: `instanceManager.cjs:86`'s local
`function spawn(opts)` (the file requires no child-process module at all) and any `regex.exec(` call.
Per-site call offsets are **reported** for the human reading the output; the **assertion** is at file
level.

*Measured: 11 spawn-bearing files, 13 child-process call sites plus one PTY site.*

| File | What it starts | Admitted? |
|---|---|---|
| `electron/ipc/sandboxEngine.cjs` | `spawn(cmd[0], cmd[1], {timeout})` at `:143`, sandboxed code execution | **`admitted:true`** — `.admit(` at `:242` |
| `electron/ipc/aiProcess.cjs` | `spawn(python, ['-u', mainScript])` at `:149` — the Python engine | `unadmitted` |
| `electron/ipc/appAssimilation.cjs` | `spawn(exe, [], {detached:true})` at `:277`, `spawn(cmd, [], {detached:true})` at `:287` — launches an assimilated app | `unadmitted` |
| `electron/ipc/astEngine.cjs` | `execSync('python <tmp> <tmp>', {timeout:10000})` at `:168` — AST analysis | `unadmitted` |
| `electron/ipc/system.cjs` | `const { exec } = require('child_process')` at `:11`, `promisify(exec)` at `:13` — OS queries | `unadmitted` |
| `electron/ipc/voiceEngine.cjs` | `spawnSync('where'\|'which', [cmd])` at `:50` and `:72`; `spawn(binary, args, {timeout:120000})` at `:218` — transcription | `unadmitted` |
| `electron/ipc/terminal.cjs` | `pty.spawn(shell)` at `:54`, behind `capability.deny(user,'terminal.open')` | `unadmitted` |
| `electron/lib/localUpdateEngine.cjs` | `spawn(cmd, args)` at `:161` — update commands | `unadmitted` |
| `electron/lib/projectScaffold.cjs` | `spawnSync('git', args, {cwd:dest})` at `:243` — `git init` in a scaffolded project | `unadmitted` |
| `electron/lib/selfBuildPipeline.cjs` | `spawn(cmd, args)` at `:49` (build steps); detached installer at `:235` | `unadmitted` |
| `electron/lib/updateChannel.cjs` | `spawn(full, [], {detached:true})` at `:464` — installer launch | `unadmitted` |

Each `unadmitted` entry carries that one-line description of **what it spawns** and no invented
exemption. Classifying a spawn path as acceptable is master's judgement, not the suite author's; the
suite's job is to make the list exact and keep it from drifting.

*Measured: 3 admit call sites, 1 authority.* `.admit(` on `code` appears in
`agentOrchestrator.cjs:281`, `instanceManager.cjs:312`, `sandboxEngine.cjs:242` — and
`resourceResearchEngine.cjs:34` is a **comment**, as the first iteration said. The authority is defined
once, as the orchestrator method at `electron/resourceOrchestrator.cjs:384`. `instanceManager.cjs:309`
declares `function admit(role)`, which is a wrapper whose body contains `res.orchestrator.admit(` at
`:312` — asserted as a wrapper rather than treated as a second authority.

*Assertions.* The set of spawn-bearing files equals `SPAWN_SITES`' file set exactly; every
`admitted:true` entry still contains `.admit(`; every `unadmitted` entry carries a non-empty
description; the set of files containing `.admit(` equals `ADMIT_CALLERS` exactly; `admit(` is defined
as an orchestrator method in exactly one file, and the only other `function admit` in the tree is
`instanceManager`'s wrapper, whose body still delegates. Counts are pinned: **11 spawn-bearing, 1
admitted, 3 admit callers.** A new spawn site is red until a human classifies it — which is what "a
fifth spawn site without an admit fails the row" has to mean on this tree.

*Mutations.* (a) add `const { spawn } = require('child_process'); spawn('x');` to a copy of
`electron/lib/modelRoles.cjs` → red (unclassified spawn-bearing file); (b) remove `.admit(` from
`sandboxEngine.cjs` → red (an `admitted:true` entry lost its call); (c) remove `res.orchestrator.admit(`
from `instanceManager.cjs` → red (`ADMIT_CALLERS` set changed and the wrapper stopped delegating).

> **FLAGGED FOR MASTER — capability versus loyalty.** Of eleven spawn-bearing modules, **one**
> (`sandboxEngine`) consults `resourceOrchestrator.admit` in the file that spawns. Two further modules
> (`agentOrchestrator`, `instanceManager`) admit and then delegate the spawn elsewhere. So **ten
> spawn-bearing modules start a child process without this process's admission authority having been
> asked** — including `terminal` (a full interactive shell, gated on `terminal.open` but not on
> resources), `selfBuildPipeline` and `updateChannel` (detached installers), and `aiProcess` (the
> engine). The evaluation's R-L5 proposes closing this. Doing it here would change admission behaviour
> on ten paths in a tranche whose purpose is to *measure*, and could refuse a spawn master expects to
> work. The decision — close all ten, close a subset, or ratify them — is master's. The first
> iteration raised "eight"; that figure was wrong and is corrected here.

### I11 — Upgrades are additive; every new engine has a working fallback · per-engine

*Source-shape, declared PARTIAL, with both halves measured* (resolves M2). "Every new engine has a
working fallback" is not fully mechanisable. Two halves are, and the row's label states the coverage it
actually has: `[source-shape, PARTIAL — 11 of 11 optional dependencies classified, 2 of 2 replaced
behaviours checked]`.

**(a) Every optional dependency's require is classified.** The project already keeps the authoritative
list: `startupDoctor.RUNTIME_OPTIONAL` (`startupDoctor.cjs:58-70`), **exported**, measured at **11**
entries — `systeminformation, simple-git, argon2, node-pty, playwright, vectra, axios, chokidar,
electron-updater, mongodb, uuid` — each with the sentence *"Present is better, absent is survivable —
each already has a fallback."* The row derives the names from that export (asserting the length is 11,
so an entry added without classification is red), then classifies **every** require site of those names
across `SHIPPED_DIRS`. Measured, 22 sites:

| Classification | Sites |
|---|---|
| `guard:'try'` — inside a `try` with a working `catch` | `cryptoCore.cjs:79`, `agentOrchestrator.cjs:15`, `browserEngine.cjs:11`, `credentialVault.cjs:57`, `terminal.cjs:13`, `timeline.cjs:29`, `vectorMemory.cjs:56`, `authCore.cjs:72`, `sysinfo.cjs:30`, `main.cjs:245`, `nucleusSealer.cjs:164` |
| `guard:'lazy'` — inside a function body, so a missing module fails one call, not the load | `vectorMemory.cjs:135`, `vectorMemory.cjs:153`, `selfBuildPipeline.cjs:142`, `selfBuildPipeline.cjs:311` |
| `guard:'safeRequire'` — top-level require, but the **module** is loaded through `safeRequire` in `main.cjs`, which is the project's declared mechanism (`safeRequire.cjs:14-16`) | `git.cjs:3` (`simple-git`), `git.cjs:4` (`chokidar`), `localUpdateEngine.cjs:38`, `publishProposal.cjs:53`, `releaseChannel.cjs:42` |
| `unguarded` — recorded breach, named on every run | `server/routes/system.cjs:5` (`systeminformation`), required at top level by `server/index.cjs:48` with no guard, so the whole API server fails to boot if the optional module is absent |

For a `guard:'safeRequire'` entry the row additionally asserts that `main.cjs` still contains the
matching `safeRequire('<path>'` call — measured present for all five — because the classification is
only true while that indirection exists. The counts are pinned (11 names, 22 sites, 1 unguarded), so a
new unguarded require of an optional dependency is red, and the one real breach is printed rather than
excused.

**(b) No `catch` restores the behaviour its engine replaced.** The Section 122 `fitContent` lesson,
written into the source that records it (`chartZoom.js:21`: *"THE FALLBACK UNDID THE FIX.
`catch { ts.fitContent(); }`"*). Frozen table, measured:

| File | `replacedSymbol` | Why |
|---|---|---|
| `src/pages/StockMind/chartZoom.js` | `fitContent` | the zoom rule replaced `fitContent`; a `catch` that calls it undoes the fix invisibly |
| `src/pages/StockMind/PriceChart.jsx` | `fitContent` | same engine, consumer side. `:1021` has `try { fitContent(); } catch { return; }` — the call is in the **try**, the catch is empty, so the row is green on HEAD and would go red if the catch were "helpfully" filled in |

Assertion: for each pair, no `catchBodies(code)` span in that file contains `replacedSymbol`. The
table's length is asserted, so an engine added with a replaced behaviour and no entry is a visible
omission rather than silent coverage.

*What it does not assert*, recorded in §13: that any fallback produces *correct* output. That needs the
engine to run.

*Mutations.* (a) move `fitContent()` into the `catch` in a copy of `PriceChart.jsx` → red; (b) plant a
top-level unguarded `require('vectra')` into a copy of `electron/lib/modelRoles.cjs` → red;
(c) delete the `safeRequire('./ipc/git.cjs'` line from a copy of `main.cjs` → red (a
`guard:'safeRequire'` classification lost its basis).

### I12 — No `console.log` in shipped code; pinned versions; no placeholders · project-wide

Three sub-checks, each on its own view, plus the pinned scope from preflight P4.

**(a) Pinned versions.** Every value in `dependencies` and `devDependencies` matches
`/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$/` — no `^`, `~`, `>=`, `*`, `x`, URL or `file:`. Measured clean
across **24** dependencies and **10** devDependencies, and both counts are pinned so a new entry cannot
arrive unchecked.

**(b) No `console.log` in shipped code.** On `code`, across `SHIPPED_DIRS`: zero matches of
`/\bconsole\s*\.\s*log\b/`. The detector deliberately does **not** require a following `(`: measured,
all four raw hits are a bare reference inside a comment or a string, so a paren-requiring detector
would be green for the wrong reason and would miss `const log = console.log` too. Measured: 4 raw hits,
**0** on `code`. This is AC5's green-on-HEAD half; the red half plants a real `console.log('x')` into a
copy of `electron/lib/http.cjs`.

**(c) No placeholder markers.** The detector is pinned as a frozen constant, because the naive forms are
both wrong on this tree (resolves M1):

```js
const MARKER_RE = /\b(TODO|FIXME|HACK|XXX)\b/;   // word-bounded: the plural "TODOs" is prose, not a marker
const MARKER_DETECTORS = Object.freeze([          // modules whose job is to find markers
  'electron/ipc/astEngine.cjs', 'electron/lib/verifyProposal.cjs' ]);
const KNOWN_MARKERS = Object.freeze([             // real I12 breaches, flagged for master
  { file:'src/pages/Agents/Agents.jsx',   line:270, text:'TODO Phase 5: send approval decision back to agent' },
  { file:'src/services/consciousness.js', line:188, text:'TODO Phase 5: write to MongoDB, build improvement dataset' } ]);
```

Measured at `8c1c9ee` with `MARKER_RE`: **6 marker lines on `raw`** — `astEngine.cjs:109` (comment),
`astEngine.cjs:110` (the detector's own regex literal), `astEngine.cjs:114` (its string literals),
`verifyProposal.cjs:9` (comment), `Agents.jsx:270`, `consciousness.js:188` — and **4 on `comments`**,
because the regex literal and the string literals are blanked there. Without the word boundary the count
is 8: `projectScaffold.cjs:44` ("A scaffold full of TODOs is worse than an empty folder") and
`NewProject.jsx:12` ("A scaffold full of TODOs looks like progress and is not (I12)") are prose, and
that difference is exactly why the detector is a frozen constant rather than a pattern written inline.

Assertions, on the `comments` view: no marker outside `MARKER_DETECTORS` except the `KNOWN_MARKERS`
entries matched by file **and** line **and** text; `KNOWN_MARKERS.length === 2`; each known marker is
still present (a list that outlives its breaches is a list nobody maintains); and **the count of
non-exempt marker lines is exactly 2** — the two `KNOWN_MARKERS` entries.

**The pin counts non-exempt lines only, not all four** (resolves finding 18). The first iteration pinned the
`comments`-view count at 4, which overrode its own exemption: an honest new `// TODO` inside
`astEngine.cjs` — a file whose job is to *detect* markers — would have turned the row red despite being
exempt. Measured on `comments` at `8c1c9ee`: 4 lines total, of which `astEngine.cjs:109` and
`verifyProposal.cjs:9` are exempt detectors and `Agents.jsx:270` and `consciousness.js:188` are the two real
breaches. So non-exempt is 2, the exemption means what it says, and the total of 4 is printed as a `NOTE`
rather than asserted. The two breaches print on that `NOTE` line in every run.

*Mutations.* (a) change a pinned version to `^1.2.3` → red; (b) plant `console.log('x')` in a copy of
`electron/lib/http.cjs` → red; (c) plant `// TODO fix this` in a copy of `electron/lib/modelRoles.cjs`
→ red; (d) remove one `KNOWN_MARKERS` entry while the comment is still there → red.

> **FLAGGED FOR MASTER — two real I12 breaches.** `Agents.jsx:270` and `consciousness.js:188` carry live
> `TODO Phase 5` markers in shipped renderer code. This tranche touches no `.jsx` (R4.3), so they are
> recorded with a counted baseline: green on HEAD, named on every run, red on a third. Master's call —
> accept them as declared debt, or authorise the two-line renderer edit in a follow-up.

### I13 — Commit and push to both `dev` and `source` · git workflow

*Declaration row.* Prints
`UNASSERTABLE  I13  git workflow — "pushed to both dev and source" is not observable in-process`,
counted in the `declared` bucket. Never a pass, never silently omitted (AC1).

No git is invoked, not even advisorily: the suite must contain no `execSync('git` on any path, which the
tripwire's own offline assertion also checks for. Reporting a local branch's position would be a
*different* claim from "pushed to both remotes", and a wrong advisory is worse than none.

### I14 — Passcode change is a full re-key · `sessionManager.changePasscode`

*Source-shape ordering, with the counts measured rather than assumed* (resolves H4). Span:
`functionBody(code('electron/sessionManager.cjs'), 'changePasscode')`.

| # | Token | Required count |
|---|---|---|
| 1 | `cryptoCore.unlock(oldPasscode` | **2** — the proof, plus the restore inside the wrong-passcode branch (`// Restore the working keys before returning — the store must stay usable`) |
| 2 | `cryptoCore.verifyPasscode(` | 1 |
| 3 | `dataStore.loadAll()` | 1 |
| 4 | `cryptoCore.secureDelete(` | 2 — `rama.salt` and `rama.verify` |
| 5 | `cryptoCore.cache.clear()` | 1 |
| 6 | `cryptoCore.unlock(newPasscode` | 1 |
| 7 | `cryptoCore.writeVerifier(` | 1 |
| 8 | `dataStore.markAllDirty()` | 1 |
| 9 | `dataStore.saveAll()` | 1 |

`orderWithin` runs over **first** offsets and asserts 1 < 2 < 3 < 4 < 5 < 6 < 7 < 8 < 9. Two pairs are
additionally asserted as **separately named** assertions with their own failure messages, so a swap is
diagnosed rather than merely counted:

- **`markAllDirty` before `saveAll`** — `saveAll` without `markAllDirty` writes nothing, which is ledger
  row 26's defect.
- **`unlock(oldPasscode)` and `verifyPasscode` before the first `secureDelete`** — the old passcode is
  proven before the salt is destroyed.

*Behavioural, with the preamble spelled out* (resolves M6). `changePasscode` opens with
`if (!isStoreOpen()) return { ok:false, error:'Store is locked' }`, and `_dataDir` is only set by
`init()`, so a cold call returns the wrong refusal. The row therefore uses `kdfFixture(ctx)`, which has
already run `init(dataDir)` and `masterUnlock(GOOD, dataDir, 'ua')` with
`dataDir = dataStore.getDataDir()` — the same directory both sides agree on under the stub. Then
`await changePasscode('wrong-one', 'a-long-enough-new-passcode')`. Measured result:
`{"ok":false,"error":"Current passcode is incorrect"}` in 427 ms, with `rama.salt` **still present**
afterwards. Both of those are the assertions.

*Mutations.* (a) swap `markAllDirty()` and `saveAll()` → red on the named pair; (b) delete
`markAllDirty()` → red on the count; (c) move the first `secureDelete` above `verifyPasscode` → red on
the named prefix.

### I15 — Absolute loyalty cannot be altered by any runtime path · `loyaltyGuard`, enforced in `nucleusSealer.encryptNucleus` + `loyaltyCore.sealCore`

*Behavioural on the guard's pure exports.* `electron/lib/loyaltyGuard.cjs` is core-Node only and loads
under plain Node. Measured export surface: `COVENANT, PROTECTED_NUCLEUS_KEYS, PROTECTED_FILES,
FORBIDDEN_KEYS, LoyaltyViolation, inspect, assertIntact, inspectOuter, assertOuterClean, inspectPatch,
assertPatchSafe, inspectChanges, assertChangesSafe, restore` — 14 names, asserted as a frozen set.

**One term per case, from a literal base** (resolves H5). `COVENANT` (`loyaltyGuard.cjs:48-54`) carries
`firstPriority: 'master'`, **not** `loyaltyPriority`, while `inspect` requires
`Array.isArray(l.loyaltyPriority) && l.loyaltyPriority[0] === COVENANT.firstPriority`. So
`{...COVENANT, master:'X'}` violates **two** terms and every assertion built on it would pass for the
wrong reason — and the mutation that deletes the master check would leave the row green. The base is
therefore written from literals, never derived from `COVENANT`, so a mutation to `COVENANT` cannot move
both sides:

```js
const PRIORITY_KEY = 'loyalty' + 'Priority';     // composed, so AC3's grep sees no fixture occurrence
const CONFORMING = Object.freeze({ master: 'Krishna Prasad', absoluteLoyalty: true, neverBetray: true,
  alwaysTransparent: true, [PRIORITY_KEY]: ['master', 'ethical_core', 'third_parties'] });
guard.assertIntact({ loyalty: CONFORMING });    // precondition: fails the row loudly if refused
```

The key is **composed from parts** (§3's rule, finding 5): a computed key produces the identical property
name, `inspect` cannot tell the difference, and the only whole-token occurrences of `loyaltyPriority` left in
the suite are the forbidden-key list and the expected-message regex — categories 1 and 2, which is what AC3
permits. The same composition is used for the reordered-priority mutation input below.

Then one term at a time, each asserting the thrown `LoyaltyViolation`'s message names **that** term —
the messages are measured from `inspect`'s own strings:

| Mutation of the base | Expected message |
|---|---|
| `master: 'Someone Else'` | `/master must remain/` |
| `absoluteLoyalty: false` | `/absoluteLoyalty must remain/` |
| `neverBetray: false` | `/neverBetray must remain/` |
| `alwaysTransparent: false` | `/alwaysTransparent must remain/` |
| `{[PRIORITY_KEY]: ['ethics','master']}` | `/loyaltyPriority must begin with/` |
| the `loyalty` block absent | `/loyalty block is missing/` |

Also asserted: `inspect(nucleus)` on the conforming base returns `{ok:true, violations:[]}`, so the
positive and negative directions both have a witness.

*The rest of the guard's surface.*

- `assertOuterClean({loyalty:{}})` throws; likewise for `ethics` and `ethicalCore` — the shell may hold
  no copy of the core. (`PROTECTED_NUCLEUS_KEYS` is measured as exactly those three.)
- `assertPatchSafe` refuses `{loyalty:{}}` (depth 0), `{a:{b:{loyalty:{}}}}` (depth 2) and
  `{a:{ethicalCore:1}}`.
- Prototype keys: built with `JSON.parse('{"__proto__":{"x":1}}')`, **not** an object literal — a
  literal's `__proto__` sets the prototype and is not an own key, which would make the assertion
  vacuous. Also `JSON.parse('{"a":{"constructor":1}}')` and `{"prototype":1}`. `FORBIDDEN_KEYS` is
  measured as exactly those three.
- `assertChangesSafe` refuses **each of the 7** `PROTECTED_FILES` in three spellings each:
  repo-relative (`electron/lib/loyaltyCore.cjs`), Windows-absolute
  (`C:\…\electron\lib\loyaltyCore.cjs`) and POSIX-absolute — NFR4's separator-normalised comparison,
  which `inspectChanges` already implements.
- `PROTECTED_FILES.length === 7` and its membership equals a frozen list in the suite: `loyaltyGuard.cjs`,
  `loyaltyCore.cjs`, `nucleusSealer.cjs`, `proposals.cjs`, `capability.cjs`, `genomeApplier.cjs`,
  `shared/capabilities.json` (measured `:62-70`). A changed length or member fails naming the delta (AC4).
- `proposals.create({changes:[{path:'electron/lib/loyaltyCore.cjs'}]})` throws `LoyaltyViolation` —
  proving `create()` is wired to the guard (`proposals.cjs:112-113`), not merely that the guard exists.

*Structural — the chokepoints are actually called.* `encryptNucleus` is **not exported** by
`nucleusSealer.cjs` (measured export list: `register, seal, unseal, lock, getLiveSystemPrompt,
patchNucleus, isSealed, getNucleus, displayIdentity, attestLoyalty, describeCore, splitCore`), so "a
non-conforming nucleus cannot be encrypted" cannot be reached behaviourally. It is proved structurally,
and the label says so:

| Span | Must contain |
|---|---|
| `nucleusSealer.cjs` → `encryptNucleus` | `assertOuterClean(` |
| `nucleusSealer.cjs` → `patchNucleus` | `assertPatchSafe(` |
| `loyaltyCore.cjs` → `sealCore` | `assertIntact(` |
| `loyaltyCore.cjs` → `openCore` | `assertIntact(` |

Plus: `exportedNames` for `nucleusSealer.cjs` must **not** include `encryptNucleus` — exporting it would
widen the surface the invariant depends on narrowing.

*Mutations.* (a) remove `assertOuterClean(` from `encryptNucleus`'s body → red; (b) delete the
`l.master !== COVENANT.master` check from `inspect`, the pattern composed as
`'l.master !== COVENANT' + '.master'` (N4, category 3) → red on the `/master must remain/` case;
(c) append an 8th entry to `PROTECTED_FILES` → red (AC4); (d) add `encryptNucleus` to `module.exports`
→ red.

### I16 — The loyalty matrix is sealed in its own envelope and no accessor returns it · `lib/loyaltyCore.cjs`

*Behavioural, and the matrix is never requested.* The export surface is enumerated and frozen —
measured at `loyaltyCore.cjs:373-379`:

```js
const CORE_EXPORTS = Object.freeze(['sealCore','openCore','lock','isOpen','withCore','attest',
  'covenantHolds','displayIdentity','describe','fingerprint',
  'BASE_ROUNDS','CEILING_ROUNDS','COOLDOWN_AFTER','COOLDOWN_MS','roundsFor']);
```

`Object.keys(require('…/loyaltyCore.cjs'))` must equal this set **exactly**. A new export fails the row,
which is R1.4 mechanised: "no accessor may be added for the suite's benefit" is enforced by the suite.

*Closed-core shapes* (before any seal): `typeof attest() === 'boolean'` and `attest() === false`;
`covenantHolds()` deep-equals `{ok:false, violations:['core is not open']}`;
`Object.keys(displayIdentity())` equals `['master']` exactly; `Object.keys(describe())` equals the nine
measured names (`present, open, version, bytes, rounds, failures, lastFailAt, nextAttemptRounds,
cooling`) exactly; `fingerprint() === null`.

*Sealed-core shapes — and the row proves **where it would write** before it writes* (resolves finding 1,
the HIGH whose failure mode was a write into master's real profile). Re-measured:
`loyaltyCore.baseDir()` is `require('electron').app?.getPath('userData') ?? null` **falling back to
`path.join(os.homedir(), '.rama-agi')`** (`electron/lib/loyaltyCore.cjs:82-87`), `corePath()` is
`baseDir()/.loyalty.enc` (`:88`), and `describe().present` is `fs.existsSync(corePath())` (`:347`).

So `present === false` is **not** a witness of isolation. It says only "there is no core wherever
`baseDir()` resolved". With the stub absent, not yet installed, or restored early, `baseDir()` is
`~/.rama-agi` — and on any machine that has never sealed a core *there*, `present` is `false` too. The
first iteration's precondition would have passed and `sealCore` would have written `.loyalty.enc` and
`.loyalty.salt` into master's home, which breaks NFR5 and drops a fixture-passcode salt into the same
directory `dataStore.getDataDir()` uses as *its* fallback. P6 cannot close this: it asserts where
`ctx.homeDir` is, not where `loyaltyCore` resolves.

**The precondition is therefore a two-sided probe of the actual directory:**

```js
// Prove baseDir() IS ctx.homeDir, rather than inferring it from an absence.
const probe = path.join(ctx.homeDir, '.loyalty.enc');
fs.writeFileSync(probe, 'probe');
if (loyaltyCore.describe().present !== true) {
  return { ok:false, detail:'loyaltyCore.baseDir() is not ctx.homeDir — refusing to seal' };
}
fs.rmSync(probe, { force:true });
if (loyaltyCore.describe().present !== false) {
  return { ok:false, detail:'the probe did not clear — refusing to seal' };
}
await loyaltyCore.sealCore(SEAL_PASS, FIXTURE_CORE);
if (!fs.existsSync(path.join(ctx.homeDir, '.loyalty.enc'))) {
  return { ok:false, detail:'the seal did not land under ctx.homeDir' };
}
```

Both directions are load-bearing. `true` proves the path identity: writing `ctx.homeDir/.loyalty.enc` can
only flip `fs.existsSync(corePath())` if `corePath()` is that same path. `false` after the removal proves
nothing pre-existed, and it also catches the dangerous case the one-sided check missed — if `baseDir()` were
master's real directory **and a real core existed there**, `present` would read `true` at step one for the
wrong reason and then stay `true` after the probe is removed, so the second check refuses. P6 has already
asserted `ctx.homeDir` is under `ctx.tmp` and empty at start; `ctx.tmp` is removed afterwards.

**The row cleans up so it is re-runnable**, which `--self-test` requires (it runs the row mutated, then
clean): a `finally` removes `.loyalty.enc`, `.loyalty.salt` and `.loyalty.attempts` from `ctx.homeDir` and
calls `lock()`. Without that, the second invocation's probe would see a real core from the first and refuse.
The seal itself is `loyaltyCore`'s own 4096-round PBKDF2, not `cryptoCore`'s argon2 path, so repeating it per
mutation is cheap (D3's overlay rule).

The fixture is defined explicitly, reusing I15's literal base:

```js
const FIXTURE_CORE = { coreVersion: 1, loyalty: { ...CONFORMING } };   // coreVersion read at :235
const SEAL_PASS    = 'a-long-fixture-passcode';
```

*Every export's return is deep-walked, not just the five readable ones* (resolves finding 6; R1.3 says
"enumerate every export, invoke each, assert the returned shape"). The row invokes all eleven callable
exports — `sealCore`, `openCore`, `lock`, `isOpen`, `withCore`, `attest`, `covenantHolds`,
`displayIdentity`, `describe`, `fingerprint`, `roundsFor` — and applies **one** depth-8 forbidden-key walk to
every return value, asserting no key named `loyaltyPriority`, `ethics`, `ethicalCore`, `neverBetray`,
`absoluteLoyalty` or `firstPriority` appears anywhere in it. A primitive or `undefined` return passes the walk
trivially, so the uniform rule costs nothing and leaves no export outside the net. Measured returns today, all
clean: `sealCore` → `{ok, version, bytes}`; `openCore` → `{ok, version}` or the cooldown refusal; `lock` →
`undefined`; `isOpen` → boolean; `attest` → boolean; `covenantHolds` → `{ok, violations}`;
`displayIdentity` → `{master}`; `describe` → the nine metadata keys; `fingerprint` → a 16-hex string;
`roundsFor` → a number; `withCore` → whatever its callback returns, so the row passes a callback returning
`true` for the walk and a capturing callback for the scrub assertion below. The point of walking a return that
is clean today is precisely that it is the gap a future change would slip through.

Additionally: `fingerprint()` matches `/^[0-9a-f]{16}$/`. `displayIdentity().master` is the single
covenant-derived string permitted to escape, which the module's own header justifies; the row asserts it is a
string and asserts nothing about its value.

*`withCore` scrubbing.* `withCore(c => { captured = c; return true; })`, then
`Object.values(captured).every(v => v === null)` (the scrub nulls every own key to depth 8, `:303-312`).
The failure message prints **only a count** of non-null values — never a key name, never a value — so
even a failing run cannot leak the shape.

*Escalation arithmetic* (pure, no I/O): `roundsFor(0) === BASE_ROUNDS`; `roundsFor(1) === 2*BASE_ROUNDS`;
monotone non-decreasing over 0…32; `roundsFor(8) === CEILING_ROUNDS` and `roundsFor(99) === CEILING_ROUNDS`.
Measured constants: `BASE_ROUNDS` 4096, `MAX_ESCALATION` 8, `CEILING_ROUNDS` 1 048 576, so
4096 × 2⁸ = 1 048 576 and the ceiling is reached exactly at the cap. **`MAX_ESCALATION` is not
exported**, so the literal `8` is written into the suite deliberately: if the cap moves, this assertion
goes red, and that is the intended behaviour, not a brittleness to be worked around.

*Cooldown refusal, with the key the code actually returns* (resolves M8). Write `.loyalty.attempts` into
the stubbed base dir as `{failures: COOLDOWN_AFTER, lastFailAt: Date.now()}`, then
`const r = await openCore('x')` → `r.ok === false`, `r.cooldown === true`, `/cooling down/.test(r.error)`.
Measured: `cooldownRefusal()` (`:128-139`) returns `{ok:false, error:'Loyalty core is cooling down after
N failed attempts — Ms remaining', cooldown:true}`. `cooling` is a key of `describe()`, not of the
refusal.

*Not asserted, recorded in §13.* That the cooldown **expires** after `COOLDOWN_MS`. `loyaltyCore` reads
`Date.now()` directly and has no clock seam; adding one is an edit to the loyalty core, which under R2
now requires a recorded master approval — so this tranche deliberately does not do it. Asserting it by
sleeping 30 s would violate NFR3.

*Mutations.* (a) add `getMatrix: () => withCore(c => c)` to `module.exports` → red (export set changed);
(b) make `displayIdentity` return the whole core → red (forbidden key found); (c) make the scrub a no-op
→ red; (d) make `roundsFor` return `BASE_ROUNDS` constantly → red.

### I17 — Baseline is declared by master; no tag, publish or bump on Rāma's initiative · Section 60, `lib/releaseChannel.cjs`

*Behavioural, through the stubbed `ipcMain` recorder.* `releaseChannel.register(ctx.ipcMain)` captures
the `release:cut` handler, registered at `electron/lib/releaseChannel.cjs:198` (corrected — `:196` closes
`release:state`; finding 12). The handler is looked up by **channel name** in `ctx.handlers`, never by
position, so the line number is documentation. Invoked as `handler(null, {user})`, the refusal
message is `${who} may not cut a release (needs "release.cut")` where
`who = capability.TIER_LABELS[String(user?.tier)] ?? 'This account'` (`:202`). Measured `tierLabels`:
`{0:'Master',1:'SuperAdmin',2:'Admin',3:'Operator',4:'Viewer',5:'Guest'}`. So the row asserts **per
case** (resolves N3):

| Input | Expected |
|---|---|
| `{user:{tier:5}}` | `{ok:false}`, error contains `Guest` |
| `{user:{tier:1}}` | `{ok:false}`, error contains `SuperAdmin` |
| `{user:'master'}` (a string) | `{ok:false}`, error contains `This account` — the fallback, because `user?.tier` is `undefined` |
| `{}` | `{ok:false}`, error contains `This account` |

**Tier 0 is never invoked** — the suite must not cut a release to test that it can. `release.cut` in
`shared/capabilities.json` is asserted `=== 0` (measured).

*Source-shape — the gate cannot be walked around.* `releaseChannel.cjs` exports `cutRelease` and
`bumpSemver` directly (measured `module.exports = { register, getState, cutRelease, bumpSemver }`), so
the capability check in the IPC handler is bypassable by any module that requires it. Measured: **no
module outside `releaseChannel.cjs` calls either.** The row pins that at zero external call sites; a
first external caller is red and forces an explicit decision (raised in §12).

*Scheduler task list — read with a **keyed** extractor inside each registration's own block* (resolves
finding 8). The two timed tasks are registered inside `registerRefresh()` (`electron/main.cjs:541`, tasks at
`:551` and `:565` — corrected, finding 12), which requires `electron` plus a dozen modules, so this half is
structural. `functionBody(code('electron/main.cjs'),'registerRefresh')` gives the span.

An **unkeyed** `stringLiteralsIn` over that span cannot express the set equality: measured, the span also
contains `'models.add-key'`, `'self-modify.view'`, `'./lib/http.cjs'`, `'./lib/ollamaLibrary.cjs'` and both
`label:` strings, and it encloses the nested `runDependencyReview` helper as well — so "the literals in this
span equal `{ollama-catalog, dependency-review}`" is **red on HEAD**. The row therefore narrows twice:

- `callsWithin(span, 'sched.register')` must be **2** (measured correct);
- for each of those two calls, `blockAfter` gives the argument object's block, and
  `keyedStringLiterals(raw, code, block, 'name')` returns exactly one literal per block;
- the union of those two literals must equal exactly `{'ollama-catalog','dependency-review'}`.

This is the use case D1's blank-don't-delete rule exists for: the span and the key are found in `code`, the
literal body is read from `raw` at the same offsets.

*"Neither writes" — narrowed, with the reason.* A blanket "no write" assertion would be **false**:
`dependency-review` calls `runDependencyReview({file:true})`, which files a proposal, which is a store
write. `main.cjs:536-539` already states the intended property — *"Nothing scheduled ever CHANGES
anything: the catalogue task refreshes a cache and the dependency task files a proposal for master. Both
are reads."* The row asserts the I17-relevant form: within each task's `run:` body (located with
`blockAfter`), `code` contains none of `releaseChannel`, `release:cut`, `cutRelease`, `bumpSemver`,
`.apply(`, `version =`, `writeFileSync`. Nothing on a timer may tag, publish, bump, or apply a proposal.

*Mutations.* (a) add a third `sched.register({name:'x', …})` → red; (b) insert
`require('./lib/releaseChannel.cjs').cutRelease({})` into a `run:` body → red; (c) demote `release.cut`
to `1` in a copy of `capabilities.json` → red; (d) delete the `capability.can(user,'release.cut')` check
from the handler → red.

### `--self-test`, as a whole

S1 first (D3): prove the overlay resolves a mutated module's relative siblings from `ctx.root`. Then for
each of the 16 assertable rows, for each mutation: read the row's file through `ctx.read`, apply `mutate`,
install the result with `ctx.setOverlay(...)` — which purges `require.cache` under `ctx.root` and `ctx.tmp`
**and clears `ctx.kdf`** — re-run `row.run(ctx)`, assert `ok === false`. Then `ctx.setOverlay(new Map())`,
re-run, assert `ok === true`, so an unconditionally-red row cannot pass. Exit non-zero naming every row whose
mutation left it green.

**Which halves run under an overlay** (finding 11, stated once so no row has to decide for itself): the
KDF-bearing behavioural halves of I1, I3 and I14 **do not** — `kdfFixture(ctx)` returns `null` when
`ctx.overlay` is non-empty, and those three rows take their overlay verdict from their source-shape halves,
each of which is written to catch that row's mutation (I1's added `token` key, I3's `else if (false)`, I14's
swapped ordering). Every other row's behavioural work is cheap and runs normally, including I16's, whose seal
is `loyaltyCore`'s 4096-round PBKDF2 and which cleans its three `.loyalty.*` artefacts in a `finally` so the
clean re-run's two-sided probe still works.

After the run, assert nothing was written under `ctx.root` and remove `ctx.tmp`.

---

## 5. `scripts/verifyLoyaltyTripwire.cjs` — the loyalty-core tripwire

### The guarded set, and how each member is guarded

Three guard classes, and **three named frozen constants**, so "is this file in the guarded set" and "may
an approval name it" both have one answer (resolves finding 4 — the first iteration named only `GUARDED`,
which left `package.json`'s membership and `capabilities.json`'s class ambiguous):

```js
const DIGEST_GUARDED     = Object.freeze(['electron/lib/loyaltyGuard.cjs',
                                          'electron/lib/loyaltyCore.cjs',
                                          'electron/nucleusSealer.cjs',
                                          'scripts/verifyLoyaltyTripwire.cjs']);
const PROJECTION_GUARDED = Object.freeze(['shared/capabilities.json']);
const STRUCTURAL_GUARDED = Object.freeze(['scripts/verifyInvariants.cjs', 'package.json',
                                          'scripts/beforeBuild.cjs',
                                          '.rama/tripwire-approvals.json']);
const APPROVABLE = Object.freeze([...DIGEST_GUARDED, ...PROJECTION_GUARDED]);
```

**Two rules range over `APPROVABLE` and nothing else:** the baseline's digest-entry key set must equal
`APPROVABLE` exactly, and an approval entry's `path` must be a member of `APPROVABLE`. A member of
`STRUCTURAL_GUARDED` therefore has **no** baseline digest entry and **cannot** be named by an approval —
there is nothing for an approval to cover, because what is asserted about those files is a shape, not a
byte sequence. (The approvals file's own sha256 *is* recorded, as an advisory top-level field rather than
a digest entry — see below.)

| Member | Class | Why this class |
|---|---|---|
| `electron/lib/loyaltyGuard.cjs` | `DIGEST_GUARDED` | the covenant's text |
| `electron/lib/loyaltyCore.cjs` | `DIGEST_GUARDED` | the sealed centre |
| `electron/nucleusSealer.cjs` | `DIGEST_GUARDED` | the encryption boundary where I15 is enforced |
| `scripts/verifyLoyaltyTripwire.cjs` | `DIGEST_GUARDED` | a guard that does not guard itself can be edited into a no-op |
| `shared/capabilities.json` | `PROJECTION_GUARDED` — tier-0 projection digest + set comparison; full-file digest advisory | a digest alone would not say *which* capability moved, and a whole-file digest would demand an approval for an unrelated tier-4 addition (D11) |
| `scripts/verifyInvariants.cjs` | `STRUCTURAL_GUARDED` (D8) | the invariant suite is meant to grow; digesting it would make every honest extension a covenant-class approval |
| `package.json` | `STRUCTURAL_GUARDED` | it legitimately changes often; what must not change is the wiring |
| `scripts/beforeBuild.cjs` | `STRUCTURAL_GUARDED` | likewise |
| `.rama/tripwire-approvals.json` | `STRUCTURAL_GUARDED` + **provenance per entry**, and its sha256 recorded advisorily | the regress argument below |

The baseline-equality assertion runs both ways: a path in `APPROVABLE` with no baseline entry fails, and a
baseline entry naming a path outside `APPROVABLE` fails. Dropping a file from the baseline is not a way to
stop guarding it, and smuggling a file in is not a way to make an unrelated edit fail.

### The approvals file: provenance per entry, plus an advisory digest (resolves finding 3)

Requirements AC13 asks for two things: an entry with no resolvable `ledgerRef` must fail, **and** the
approvals file's own digest must be checked. The first is the provenance rule below. The second cannot be
a *verdict* rule — digesting the approvals file would mean a change to it needs an approval, which lives
in that same file, which changes its digest: a regress with no fixed point. So the digest is **recorded
and reported, and does not decide the verdict**:

- `--record-baseline` writes `approvalsSha256` as a top-level baseline field (not a digest entry, so the
  `APPROVABLE`-equality rule above is unaffected);
- a check whose computed approvals digest differs prints
  `NOTE approvals file changed — <A> → <B>; <n> entries revalidated` and continues;
- every entry is revalidated on every run regardless, so the digest adds provenance to the output rather
  than a second gate.

AC13's failing case still bites, through the entry rules rather than the digest: a fabricated entry with
no resolvable `ledgerRef` fails the run. Nothing is weakened, and the clause is literally satisfied — the
digest is computed, compared and reported. No requirements amendment is needed.

### The per-entry provenance rules

R2.5 asks for the approvals file in the guarded set, and the paragraph above explains why its digest is
advisory rather than fatal. What carries its integrity instead: **every entry has to name text master
wrote into the spec**. For each entry the tripwire requires

- `path` — a repo-relative member of `APPROVABLE`, normalised with the same forward-slash, lower-case rule
  `loyaltyGuard.inspectChanges` uses (NFR4);
- `sha256` — exactly 64 lower-case hex characters (for `shared/capabilities.json`, the **projection**
  digest of D11);
- `approvedAt` — an ISO-8601 string `Date.parse` accepts;
- `approvedBy` — a non-empty string;
- `reason` — a non-empty string of at least 20 characters (a one-word reason is not a record);
- `ledgerRef` — a string of at least 12 characters that **contains the basename of `path`** and occurs
  verbatim inside **Section 28** of `RAMA_AGI_MASTER_SPEC.md`, where Section 28 is the span from the
  `## SECTION 28` heading to the next `## SECTION` heading (measured: lines 1607 to 1818).

The basename and minimum-length rules exist so a ref of `"the"` or `"approved"` cannot resolve trivially.
The tripwire **reads** the spec and never writes it (R2.4). An entry failing any rule fails the run,
naming the entry's index and the rule — and because a forged approval would have to appear inside
Section 28 of a document that is reviewed and committed, the approval is a record in the project's own
sense, not a flag.

An approval for a file whose content has *not* changed is reported as
`stale approval (file matches baseline)` and does not fail — it is noise, not a breach.

### Verdict logic

```
load baseline        → missing / unparseable / version mismatch  ⇒ FAIL (reason named)
                     → digest-entry key set != APPROVABLE        ⇒ FAIL (naming the delta, both ways)
load approvals       → missing is OK (zero approvals); unparseable ⇒ FAIL
                     → sha256 != baseline.approvalsSha256        ⇒ NOTE, not a failure (finding 3)
load spec            → unreadable, or no Section 28 heading ⇒ FAIL (approvals cannot be validated)
for each member of DIGEST_GUARDED:
   read + sha256     → unreadable ⇒ FAIL (reason named)
   digest == baseline ⇒ PASS  "unchanged"
   else a valid approval for (path, found digest)
                     ⇒ PASS  "changed, approved: <reason> (<ledgerRef>)"
   else an approval exists for path with a different digest
                     ⇒ FAIL  "this approval does not cover this content — approved <A>, found <B>"
   else              ⇒ FAIL  "this file changed — expected <A>, found <B>, and no approval names <B>"
capabilities.json    → tier-0 projection + ladder comparison                     (D11)
structural members   → wiring + invariant-suite shape                           (below)
exit(fail ? 1 : 0)
```

The two distinct failure sentences are AC9's requirement: *"this file changed"* and *"this approval does
not cover this content"* are different diagnoses and must read differently.

### Structural checks — the part no digest can express

- `package.json`: the `verify` script string contains both `verifyInvariants.cjs` and
  `verifyLoyaltyTripwire.cjs`; `build.beforeBuild === 'scripts/beforeBuild.cjs'` (measured present).
- `scripts/beforeBuild.cjs`: its source contains `verifyLoyaltyTripwire` on a line that is not a comment.
- `scripts/verifyInvariants.cjs`: exists, is non-empty, contains each of the seventeen ids `'I1'`…`'I17'`
  as a `ROW_IDS` member, and contains the `--self-test` branch (D8).

### `--record-baseline`

The only writer of `.rama/tripwire-baseline.json`, with D9's four cases and an all-or-nothing write. It
records `{version:1, recordedAt, digests:{<every member of APPROVABLE>: sha256}, tier0, ladder,
projectionSha256, fileSha256, approvalsSha256}` and prints every digest it records. No check path ever
writes a baseline: a check that silently re-baselines is a check that always passes (R2.6).

`.rama/` does not exist yet and is created by this flag. `.gitignore` was read: it excludes
`node_modules/`, `dist-electron/`, `build/`, `data/`, `*.enc`, `rama.salt`, `rama.verify`,
`.nucleus.enc`, `.nucleus.salt`, `shared/buildManifest.json` — **`.rama/` is not excluded and neither
file matches any pattern**, so both are committed with no `.gitignore` change. The implementation
re-checks this with `git check-ignore` **outside** the verdict path (an advisory one-off during
implementation, not a runtime dependency).

### Offline and git-free by construction

No `require('http')`, no `require('https')`, no `child_process`, no `git` on any path — not even
advisorily. `git tag` returns **zero tags** in this repository (measured), so the evaluation's
`git diff --name-only <lastTag>..HEAD` mechanism has no base here; and a verdict depending on history
state, or on git being installed, is a verdict that differs between master's machine and a build agent.
Digests depend on nothing but the bytes on disk. AC12's
`Select-String … "require\('https?'\)|execSync\('git"` therefore finds nothing.

### Entry points

Standalone (`node scripts/verifyLoyaltyTripwire.cjs`), in `npm run verify` (D7), and from
`scripts/beforeBuild.cjs` so a package cannot be produced over an unapproved covenant change. The call
goes at the **top** of `beforeBuild`'s exported function, before the icon work:

```js
const r = require('child_process').spawnSync(process.execPath,
  [path.join(root, 'scripts', 'verifyLoyaltyTripwire.cjs')], { cwd: root, stdio: 'inherit' });
if (r.status !== 0) throw new Error('Loyalty tripwire failed — refusing to package. See the output above.');
```

It must **throw**: `beforeBuild` returning `false` is already overloaded to mean "dependency
install/rebuild is handled outside electron-builder" (measured in the file's own comment), so a
non-throwing failure would be swallowed. The packaging path **cannot be exercised in this worktree**
(`electron-builder` is not invocable here); that limitation is stated, not papered over (AC14).

### Acceptance criteria this section adds beyond the requirements' list

- **AC-T6 (from D9):** with an unapproved one-line edit to `electron/lib/loyaltyGuard.cjs`,
  `node scripts/verifyLoyaltyTripwire.cjs --record-baseline --force` exits non-zero, writes **no**
  baseline, and names the file plus "an approval entry is the only way forward". Reverting the edit makes
  the same command succeed.
- **AC-T7 (from D11):** adding a tier-4 capability to `shared/capabilities.json` leaves the tripwire
  green with a `NOTE` that the file changed outside the guarded projection; demoting `release.cut` to `1`
  fails naming `release.cut`, `0` and `1`; promoting a capability to tier 0 passes and is reported.
- **AC-T8 (from D8):** deleting a `ROW_IDS` entry from `scripts/verifyInvariants.cjs` fails the
  tripwire's structural check **and** the invariant suite's own preflight P2.

---

## 6. Self-modification boundary — do these additions open a path to the loyalty core?

**No, and here is the argument, route by route.** The question is not whether the new files are
*protected* — they are not, and that is the honest part — but whether they create a path that did not
exist before, and whether their removal is silent.

**1. Do the new files touch the loyalty core?** No. Both suites only **read**: `fs.readFileSync`,
`crypto.createHash`, `require` of already-existing modules. Neither calls `encryptNucleus`,
`patchNucleus`, `proposals.approve` or `proposals.apply`. `verifyInvariants` *does* call `sealCore` once,
in the I16 row — into a **temp directory** supplied by the stubbed `app.getPath`, and only after a
**two-sided probe** has proved that `loyaltyCore.baseDir()` resolves to `ctx.homeDir`: a probe file written
there must make `describe().present` read `true`, and removing it must make it read `false` (§4, I16). An
absence on its own proves nothing, because `baseDir()` falls back to `~/.rama-agi`; that was finding 1, and
it is the only place in this design where a write could have escaped temp. The row asserts the sealed core's
*shape*, never its content, removes its artefacts in a `finally`, and `sealCore` itself still calls
`assertIntact`, so the suite cannot seal a non-conforming core either.

**2. Does the tripwire's approval mechanism become a new way to reach the core?** It is the opposite of
an opening: before this tranche, editing `loyaltyGuard.cjs` by hand passed `npm run verify` silently.
After it, such an edit fails until an approval naming the new digest exists **and** that approval's
`ledgerRef` is found inside Section 28 of the spec. The mechanism adds a gate; it grants nothing. It
cannot *approve* a change — only recognise one master already recorded — and it has no write path to any
guarded file.

**3. Can the self-build / proposal path disable the tripwire?** Partially, and loudly. Measured:
`PROTECTED_FILES` covers `loyaltyGuard.cjs`, `loyaltyCore.cjs`, `nucleusSealer.cjs`, `proposals.cjs`,
`capability.cjs`, `genomeApplier.cjs`, `shared/capabilities.json` — and **not** `scripts/*`,
`package.json` or `.rama/*`. So a `SELF_MODIFY` proposal could in principle target the tripwire. Five
things stand in the way, and they compose:

- **Editing it fails immediately.** The tripwire's own source is in its digest set, so any edit — by
  proposal, by hand, by a build script — makes the very next run fail until an approval names the new
  digest. A tripwire edited into `process.exit(0)` reports its own modification before it exits.
- **Deleting it fails too, via mutual attestation.** `verifyInvariants`' preflight P1 asserts the tripwire
  exists, is non-empty, and is named in `package.json`'s `verify` chain; the tripwire's structural check
  asserts the same of `verifyInvariants.cjs` plus its row-id list and `--self-test` branch. Deleting
  either makes the other red. Deleting both makes `npm run verify` fail on a missing module path, because
  `node` exits non-zero when the entry file does not exist. Unwiring either from `package.json` fails the
  wiring check. **There is no single edit that removes the check silently.**
- **An approval cannot be forged inside the mechanism.** A fabricated entry in
  `.rama/tripwire-approvals.json` needs a `ledgerRef` that occurs inside Section 28 of
  `RAMA_AGI_MASTER_SPEC.md`. The tripwire never writes the spec, and a proposal that edited the spec to
  plant a ref would be a visible diff in the document master reads first.
- **`--force` cannot re-bless a tampered file (D9).** This was the hole in the first iteration's
  argument. `--record-baseline --force` now **refuses and writes nothing** when any guarded member is
  changed-and-unapproved, naming the file. So the one path that could have produced a green chain over a
  tampered `loyaltyGuard.cjs` — re-recording the baseline rather than approving the change — is closed,
  and AC-T6 is the mechanical proof.
- **`apply` still needs master.** `proposals.apply` authorises on `self-modify.apply`, tier 0 (asserted by
  I6's row, and `capabilities.json` measured `self-modify.apply === 0`). A proposal can be *created*
  against a script path, but not applied by anything below master.

**4. The residual exposure, stated plainly.** A tier-0 actor — master, or anything already holding
master's authority — can remove this machinery. That is true of every check in the project and is not a
defect this tranche can close; the covenant's own design already concedes that a local attacker with
master's OS account is outside the threat model (`loyaltyCore.cjs`'s `readAttempts` header). A second,
smaller residual comes from D8: `verifyInvariants.cjs` is guarded structurally, so a *row's contents* can
be weakened without an approval. `--self-test` turns that red whenever it is run, and the weakening is a
visible diff in a file whose entire purpose is to be read — but it is not a build-time refusal, and that
is the deliberate trade recorded in D8 and flagged in §12.

**5. The clean fix is the deferred one, and it now has a mechanism.** R-L3 adds
`scripts/buildInstaller.cjs`, `beforeBuild.cjs`, `afterPack.cjs`, `main.cjs`, `preload.cjs`,
`selfRepair.cjs`, `updateChannel.cjs`, `package.json`, `package-lock.json` to `PROTECTED_FILES` — and
should add the two new scripts and `.rama/*`. Doing it requires editing `loyaltyGuard.cjs`, which is
itself guarded, so **R-L3's first act is to produce the first approval record this tripwire will ever
consume.** That is the intended handoff, and it is why R-L3 is sequenced after R-L2 rather than bundled
into it.

**6. Nothing here requires the loyalty matrix to be returned (I16).** The I16 row enumerates exports and
asserts the shape of what comes back; the tripwire hashes bytes. No accessor is added to
`loyaltyCore.cjs`, and the I16 row's frozen export list makes adding one a failing assertion.

---

## 7. R3 — generalised staleness: implemented additively, with two consumers deferred

R3.0's gate is met for the module and for two consumers, so R3 is **implemented, partially adopted**.
R3.3 permits partial adoption; the two deferrals are reasoned, not convenient.

### `electron/lib/staleness.cjs` — new, pure, core-Node only

```js
describe({ asOf, budgetDays, now = Date.now(), label = 'this data', recheckAt = null })
  → { asOf, days, stale, neverFetched, budgetDays, warning }
```

Field names mirror `ai_backend/engine/costs.py:420-446` (`asOf`, `days`, `stale`, `warning`) so the
project has one vocabulary across both runtimes, plus `neverFetched`. `costs.py` is **not changed**
(R3.6): the Python engine cannot be run here, so the JS module copies the vocabulary rather than the
reverse.

| Input | Rule | Behaviour on failure |
|---|---|---|
| `asOf` | optional; ISO-8601 string or epoch-ms number | missing, `null`, `''`, `NaN` or unparseable ⇒ `{days:null, stale:true, neverFetched:true, warning:'<label> has never been fetched, so its age cannot be measured'}` |
| `budgetDays` | required; finite number > 0 (fractional allowed) | invalid ⇒ fail toward stale, in one of **two fully specified shapes** — see below |
| `now` | optional; finite number (epoch ms) | invalid ⇒ falls back to `Date.now()` |
| `label` | optional string, trimmed, capped at 80 chars | non-string ⇒ `'this data'` |
| `recheckAt` | optional string, capped at 200 chars | absent ⇒ the warning omits the re-check clause |

**The invalid-budget branch, both halves written out** (resolves finding 14 — `verifyStaleness.cjs` asserts
exact shapes, so leaving `days` and `neverFetched` unstated would let the implementer's guess decide whether
the module and its suite agree, and AC15 forbids one of the two readings):

```
invalid budget + parseable asOf → { asOf, days: <floored age>, stale:true,  neverFetched:false,
                                    budgetDays:null,
                                    warning:'the staleness budget for <label> is not a positive number, so age cannot be judged' }
invalid budget + missing asOf   → { asOf:null, days:null,      stale:true,  neverFetched:true,
                                    budgetDays:null,
                                    warning:'<label> has never been fetched, so its age cannot be measured' }
```

The age is still reported when it is measurable — suppressing a known `days` because the *budget* is broken
would throw away the one fact the caller has — and `neverFetched` is reserved for the case where there is no
`asOf` at all, so AC15's "`neverFetched` never coexists with a numeric `days`" holds in both branches.

Semantics, each one an assertion in the suite:

- **`days` is for display; `stale` is computed at millisecond resolution** (resolves M4):
  `days = Math.floor((now - t) / 86_400_000)` and `stale = (now - t) > budgetDays * 86_400_000`. Flooring
  the age *and* comparing in days would disagree with every existing consumer flag across the whole
  interval `(budget, budget+1 day)` — which is exactly where staleness matters. `costs.py:439`'s
  `days > 400` is a day-resolution budget, so mirroring the **vocabulary** does not require mirroring the
  resolution, and the strictly-greater boundary is preserved: an age of exactly `budgetDays` days is
  fresh, one millisecond more is stale. That is AC15's boundary.
- **`neverFetched: true` never coexists with a numeric `days`** (R3.2). `days` is `null`, never `0`. A
  never-fetched fact must never render as fresh and must never render as a measurement of absence — the
  `charge_watch.py` rule, and the reason ledger row 114's fabricated search-failure marker scored 0.60 and
  passed vetting.
- `warning` is `null` unless `stale` or `neverFetched`; when present it names the `asOf` date, the age in
  days, and `recheckAt` if given.
- A future `asOf` (clock skew) → `days: 0`, `stale: false`, and a `warning` naming the skew. Returning a
  negative `days` would let a consumer render "−3 days old".
- `describe` **never throws**: every branch returns a shape (R3.5).

### Adopted now

**One adoption shape for both consumers: a single nested `staleness` key, no flat duplicates** (resolves
finding 20). The first iteration gave `ollamaCatalog` a nested `staleness` *plus* flat `days`,
`neverFetched` and `warning`, and `refreshScheduler` the nested key only — two vocabularies, against R3.1's
"one vocabulary, one module". Nested-only is chosen: it is the smaller addition, it reads the same on both
surfaces, a renderer reaches everything through `x.staleness.<field>` in both places, and there is exactly
one spelling of each field name in the project. Nothing is lost — the flat keys were a copy of fields the
nested object already carries.

**`ollamaCatalog.loadCatalog({now})`** (`electron/lib/ollamaCatalog.cjs:78-97`) — the function is
`loadCatalog`, not `read`, it is clocked by a **`Date`**, and it returns **seven** keys (resolves M3):
`catalog, schedule, source, fetchedAt, ageMs, stale, empty`. All seven keep their names and values. Added:
`staleness`, and nothing else. The budget is the module's own existing constant,
`budgetDays: STALE_AFTER_MS / 86_400_000` (measured `STALE_AFTER_MS = 24 h`, exported), and the clock is
converted at the call site with `now.getTime()`. Because `stale` is computed at ms resolution (M4), the
suite can assert `loadCatalog({now}).stale === loadCatalog({now}).staleness.stale` across a fixture set —
proving there is one definition of stale rather than two that drift. The module already exports
`useStore(store)`, so the fixture needs no Electron and no real store.

**`refreshScheduler.status({now})`** (`electron/lib/refreshScheduler.cjs:233-256`) already injects its
clock and returns `{running, tasks:[…]}`, with each task carrying `name, label, capability, enabled,
intervalMs, lastRunAt, lastOk, failures, lastError, nextDueAt, overdue, backingOff` — the top-level
`running` flag (`:236`) plus twelve per-task keys, **all thirteen preserved** (finding 15: `running` was
missing from the first iteration's AC16 fixture, and R3.3 requires every key returned today). Added per
task: `staleness` from `{asOf: lastRunAt, budgetDays: (intervalMs * 2) / 86_400_000}` — two missed
intervals, documented at the call site.

**The `Math.max(1, …)` clamp is dropped** (resolves finding 16). It only meant "two missed intervals" for
`intervalMs ≥ 12 h`; below that it silently became a one-day floor that contradicted the comment next to it.
Both current tasks are daily (`electron/main.cjs:548`, `DAY`), so the clamp changes nothing today and
removing it changes nothing today — but `describe` accepts fractional `budgetDays`, so the unclamped form
keeps meaning what the comment says for an hourly task a later session registers. `lastRunAt === null` ⇒
`neverFetched: true`, which is R3.2's distinction: a task that has never run is not a task that ran zero
days ago. The module exports `useStore` and `reset`, so this is unit-testable with no Electron.

### Deferred to roadmap 2.4, with reasons

| Consumer | Why not now |
|---|---|
| `dependencyAdvisor.review()` | its output flows into `toProposal()`, so added keys change the body of a proposal **master is asked to approve**. Changing the approval surface is not the same kind of additive as changing a report, and it belongs with the §9.4 privacy decision rather than with verification machinery |
| `ollamaLibrary.refresh()` | it **persists** `fetchedAt` into the store, so added keys change a persisted shape and need a read-path migration for documents written by the current build. Additive in the return value, not additive on disk |

### Fallback (R3.5, I11)

Each consumer reaches the module through a **module-local** helper that returns `null` on any failure, and
adds the `staleness` key only when it is non-null. No shared helper is introduced: `warnOnce` does not exist
anywhere in this tree (measured — neither `ollamaCatalog.cjs` nor `refreshScheduler.cjs` has it), and
inventing one would be a second new module under `electron/lib/` that R3.0 never gated (resolves
finding 13). The "once per process" state is a module-local flag, written out so there is nothing to invent:

```js
let _stalenessWarned = false;                       // one per consumer module, module scope

function stalenessFor(opts) {
  try { return require('./staleness.cjs').describe(opts); }
  catch (err) {
    if (!_stalenessWarned) {
      _stalenessWarned = true;
      console.warn('[ollamaCatalog] staleness unavailable:', err.message);
    }
    return null;
  }
}
```

The same six lines go in `refreshScheduler.cjs` with its own tag and its own flag — duplicated deliberately,
because the alternative is a shared module whose own absence would need the same guard. With
`electron/lib/staleness.cjs` renamed away, both consumers return **exactly** their pre-R3 shapes and throw
nothing, warning once each. `verifyStaleness.cjs` proves this by stubbing the module's absence through
`Module._resolveFilename` (AC18). `console.warn`, never `console.log` (I12).

### It does not touch the loyalty core (R3.4)

No change to `loyaltyGuard.cjs`, `loyaltyCore.cjs`, `nucleusSealer.cjs` or `shared/capabilities.json`. The
mechanical proof is `node scripts/verifyLoyaltyTripwire.cjs` exiting 0 on the R3 commit (AC17) — which is
why the tripwire lands before R3 in the commit order (§11).

### `scripts/verifyStaleness.cjs`

Unit assertions over `describe` (every row of the input table, the boundary at `budgetDays` and one
millisecond past it, the future-`asOf` case, and `neverFetched` never coexisting with a numeric `days`);
both invalid-budget branches; the pre-R3 fixture comparison for both adopted consumers (AC16 — a frozen
object of **all seven** `loadCatalog` keys, and of `status`'s top-level **`running`** plus **all twelve**
per-task keys, asserted still present and equal); the `stale`-agreement assertion; and the module-absent
fallback (AC18). The fixture also asserts that the only **added** key on either surface is `staleness`, so
the one-vocabulary decision is checked rather than trusted.

---

## 8. Error handling, per operation

Nothing here is a long-running service, so there are two outcomes: an assertion verdict, or a suite-level
failure. Both are explicit; neither is a skip.

| Operation | Failure condition | Recoverable? | What the caller gets | Logged at |
|---|---|---|---|---|
| `ctx.read(rel)` | file missing or unreadable | **fatal to the row** | row FAILS: `cannot read <rel>: <errno>` | `console.log` FAIL line |
| `ctx.load(rel)` | `require` throws | **fatal to the row** | row FAILS: `cannot load <rel>: <message first line>` | FAIL line |
| `ctx.materialise(rel)` | temp write fails | **fatal to the self-test**, not to a normal run | exit 1 naming the path; a normal run never calls it | FAIL line |
| `functionBody(code,name)` | name not found | **fatal to the row** | row FAILS: `<name> not found in <rel> — a renamed enforcement point is the failure being guarded` | FAIL line |
| a row's `run` throws | any unexpected error | **fatal to the row**, never to the suite | row FAILS with `threw: <message>`; remaining rows still run | FAIL line |
| `kdfFixture` | `masterUnlock` returns `ok:false`, or throws | **fatal to I1, I3, I14**; each fails naming the fixture | three FAIL lines, one reason | FAIL line |
| I16's two-sided probe, step 1 | probe written to `ctx.homeDir/.loyalty.enc`, `describe().present !== true` | **fatal to the row, and it does not seal** | row FAILS: `loyaltyCore.baseDir() is not ctx.homeDir — refusing to seal` | FAIL line |
| I16's two-sided probe, step 2 | probe removed, `describe().present !== false` | **fatal to the row, and it does not seal** — this is the branch that catches a real core sitting in master's profile | row FAILS: `the probe did not clear — refusing to seal` | FAIL line |
| I16's post-seal check | `.loyalty.enc` absent under `ctx.homeDir` | **fatal to the row** | row FAILS: `the seal did not land under ctx.homeDir` | FAIL line |
| I16's cleanup | removing `.loyalty.*` from `ctx.homeDir` fails | **not fatal**; `ctx.tmp` is removed wholesale afterwards | `NOTE` naming the leftover path; a later re-run of the row would then refuse at step 2 rather than seal over it | NOTE line |
| `kdfFixture(ctx)` under a non-empty overlay | by design, not an error | the KDF-bearing halves **do not run** | `kdfFixture` returns `null`; I1/I3/I14 take the verdict from their source-shape halves and say so in the row detail | detail on the PASS/FAIL line |
| electron stub install/restore | `Module._resolveFilename` restore fails | **fatal to the suite** | exit 1: `the module resolver could not be restored; later rows would be unsound` | FAIL line |
| scanner fixture | any assertion fails | **fatal to the suite, before the rows** | exit 1: a broken scanner makes every absence assertion vacuous | FAIL line |
| temp dir create / remove | EPERM, EBUSY | create fatal to the suite; **remove is best-effort** | create: exit 1 with the path; remove: a `NOTE` naming the leftover path | NOTE line |
| `spawnNode(auditRenderer)` | non-zero exit, or spawn error | **fatal to the row** | I7 FAILS, reproducing the child's last 20 output lines | FAIL line |
| preflight P1–P6 | any | **fatal to the suite**; P3 runs after the rows, the rest before | exit 1 naming the preflight | FAIL line |
| baseline load | missing | **fatal on a check; expected on `--record-baseline`** | check: exit 1, `baseline missing — run --record-baseline` | FAIL line |
| baseline load | unparseable, or `version !== 1` | **fatal** | exit 1: `baseline unparseable at <offset>` / `baseline version <n> is not 1` | FAIL line |
| approvals load | unparseable | **fatal** | exit 1: `approvals file is unparseable; refusing to proceed` | FAIL line |
| approvals load | file absent | **not a failure** | treated as zero approvals; any changed guarded file then fails for want of one | NOTE line |
| approvals digest | differs from `baseline.approvalsSha256` | **not a failure** (finding 3's regress argument) | `NOTE approvals file changed — <A> → <B>; <n> entries revalidated`; the entry rules are what gate it | NOTE line |
| baseline key set | digest-entry keys ≠ `APPROVABLE`, either way | **fatal** | exit 1: `baseline covers <list> but APPROVABLE is <list>` — a dropped entry is how a file stops being guarded | FAIL line |
| approval entry | any field rule fails | **fatal** | exit 1: `approval[<i>] for <path>: <which rule>` | FAIL line |
| spec load | unreadable | **fatal** | exit 1: `cannot read RAMA_AGI_MASTER_SPEC.md, so no approval can be validated` | FAIL line |
| spec load | `## SECTION 28` heading not found | **fatal** | exit 1 naming the heading it looked for | FAIL line |
| guarded file read | unreadable | **fatal** | exit 1: `<path> is unreadable — refusing an indeterminate verdict` (AC12) | FAIL line |
| `capabilities.json` parse | unparseable, or `capabilities`/`tiers` missing | **fatal** | exit 1, fail-closed, reason named | FAIL line |
| `--record-baseline` | baseline exists, no `--force` | **refused** | exit 1: `a baseline already exists; pass --force to replace it` | FAIL line |
| `--record-baseline --force` | a guarded member is changed-and-unapproved | **refused, nothing written** (D9) | exit 1: `<path> changed and no approval names <digest>; an approval entry is the only way forward` | FAIL line |
| `beforeBuild` tripwire call | child exits non-zero | **fatal to the package** | `throw new Error('Loyalty tripwire failed — refusing to package')` | the child's own output, inherited |
| `staleness.describe` | any bad input | **never throws** | a shape with `stale:true` and a `warning` naming the problem | nothing — it is a value, not an event |
| a consumer's staleness helper | `staleness.cjs` missing or throwing | **recoverable** | `null`, so the consumer returns its pre-R3 shape with no `staleness` key | `console.warn` once per consumer module, gated by that module's own `_stalenessWarned` flag — never `console.log` (I12) |

`console.log` is used only in `scripts/`, as the PASS/FAIL reporter all 22 existing suites use, and that
scope is pinned by preflight P4. Nothing added under `electron/` logs at `log` level.

---

## 9. Which layer owns which invariant

| Invariant of this design | Owning layer | Why there |
|---|---|---|
| "a row that cannot assert must fail, never skip" | the **runner**, not the rows | a row left to decide its own skippability is a row that skips. The runner only accepts `{ok:true\|false}`; there is no third value to return |
| "exactly 17 rows" | the **runner's** preflight P2, and the **tripwire's** structural check | a count printed at the end can be made to print 17; an id-list equality check cannot, and two files asserting it means one edit cannot hide it |
| "I16 never requests the matrix" | the **I16 row's frozen export list** | enforced where a violation would have to be written: adding an accessor changes the export set and fails the row |
| "the suite is dependency-free" | the **runner's** preflight P3, with `CACHE_ALLOWED` | the only place that can see every module every row loaded |
| "a behavioural row never writes outside temp" | **preflight P6 plus the I16 row's two-sided probe** | P6 proves where `ctx.homeDir` is; only the probe proves where `loyaltyCore.baseDir()` *resolves*, because `baseDir()` is evaluated at call time, falls back to `~/.rama-agi`, and an absence there is indistinguishable from isolation (finding 1). The write-side check has to live in the row that writes |
| "approval covers exact content" | the **tripwire's digest comparison** | a flag is set once; a digest is bound to bytes |
| "an approval is a record" | the **spec**, read by the tripwire | the tripwire cannot create provenance, only verify it. Keeping the authority in the document master edits is the point of I6's two-record pattern |
| "a baseline is never re-blessed silently" | the **`--record-baseline` path**, via D9 | the only writer is the only place that can refuse to write |
| "the covenant holds" | **`loyaltyGuard`**, unchanged | the tripwire guards the guard's *text*; the guard guards the nucleus. Moving covenant logic into a verify script would create a second definition |
| "nothing on a timer tags or publishes" | **`capability.cjs` + `releaseChannel`**, asserted by I17's row | enforcement stays at the capability gate; the row only proves the gate is still there |
| "`neverFetched` ≠ `days: 0`" | **`staleness.cjs`** | one module, so no consumer can re-derive it differently |
| "no second definition of stale" | the **consumer**, by passing its own existing budget constant | the threshold already exists at the consumer; duplicating it inside `staleness.cjs` is what would drift |

---

## 10. Testability, cost, and what cannot be tested here

**Unit-testable, and tested:** `staleness.describe` (every input row, both sides of the boundary);
`loyaltyGuard`'s nine exported predicates, one covenant term at a time; `loyaltyCore`'s shape surface and
`roundsFor` arithmetic; `proposals.authorise`/`approve`/`apply` refusals, by branch;
`authCore.createUser`/`setUserTier` tier floors and `issueAccessKey`'s HMAC-only record; digest
computation; approval validation; tier-0 projection extraction; and the scanner itself, through its own
fixture block.

**Integration-tested here:** the overlay (S1, then 16 rows × their mutations); the `auditRenderer` child
spawn; the tripwire's five verdict branches driven by real temp files; `--record-baseline`'s four cases
including D9's refusal; the mutual-attestation checks.

**Measured cost** (§1, re-stated because NFR3 is a requirement and not an aspiration):

| Run | Measured / projected |
|---|---|
| KDF-bearing behavioural work, shared via `kdfFixture` | **1.41 s measured** |
| `node scripts/auditRenderer.cjs` child (I7) | **2.51 s measured** |
| `node scripts/verifyInvariants.cjs` | **≈ 5 s projected**, to be recorded as measured on implementation |
| `node scripts/verifyInvariants.cjs --self-test` | source-shape mutations only, no KDF repeat — to be measured; the budget it must respect is stated here so exceeding it is a visible decision, not a drift |
| `node scripts/verifyLoyaltyTripwire.cjs` | sha256 over 6 files plus one JSON parse — sub-second |

If the implementation's measured figure for either suite exceeds NFR3's 10 s, the budget is raised **with
master** rather than quietly exceeded.

**Cannot be exercised in this worktree, and is reported as such rather than claimed:**

- `electron-builder`'s `beforeBuild` hook — not invocable here. `node --check scripts/beforeBuild.cjs` and
  the `Select-String` for `verifyLoyaltyTripwire` are the available proofs (AC14).
- `vite build` — `node_modules` is absent in this worktree (measured). No `.jsx` is touched, so no
  renderer claim is made (R4.3, R4.5).
- The Python engine — `import numpy` raises here; `costs.py` is unchanged (R3.6).
- `loyaltyCore`'s cooldown **expiry** — no clock seam, and adding one is a loyalty-core edit (§4, I16).

**A design that was hard to test, reconsidered three times.** The first shape had each row own its file
reads and its `require`s, which made `--self-test` impossible without copying the tree — that forced the
`ctx` indirection (D3). The second shape mapped overlay siblings by path equality, which cannot resolve a
mutated module's relative requires at all — that forced the rebase rule and fixture S1. The third pass
found the subtler version of the same disease: a row can be *written* and still not be a test. I6 asserted
"refused, naming I6" against a function whose two refusal branches both name I6, so the mutation proved
nothing; I16 inferred isolation from an absence, which is not a measurement of where a write would land;
I7 counted a field across a file instead of inside the array it belongs to. Each is the same correction —
**assert the distinguishing thing, in the smallest span that contains it** — and each made the row longer
and the self-test honest. That trade is the right way round: a suite nobody can prove notices a breach is
the thing the evaluation found 22 of.

---

## 11. Files, and commit order

| # | File | Change | Commit |
|---|---|---|---|
| 1 | `scripts/verifyInvariants.cjs` | **new** | `feat(verify): assert I1-I17 at their enforcement points, with a planted-breach self-test` |
| 2 | `package.json` | `verify:invariants` + `verify:covenant`, appended to the chain (D7) | same commit as 1 |
| 3 | `scripts/verifyLoyaltyTripwire.cjs` | **new** | `feat(loyalty): digest-matched tripwire on the covenant files` |
| 4 | `.rama/tripwire-baseline.json` | **new**, from `--record-baseline` (bootstrap case, D9) | same commit as 3 |
| 5 | `.rama/tripwire-approvals.json` | **new**, `{version:1, approvals:[]}` | same commit as 3 |
| 6 | `package.json` | `verify:tripwire` + chain | same commit as 3 |
| 7 | `scripts/beforeBuild.cjs` | throwing `spawnSync` call at the top of the hook | same commit as 3 |
| 8 | `electron/lib/staleness.cjs` | **new** | `feat(staleness): one vocabulary for the age of a served fact` |
| 9 | `electron/lib/ollamaCatalog.cjs` | added keys only, in `loadCatalog` | same commit as 8 |
| 10 | `electron/lib/refreshScheduler.cjs` | added keys only, in `status` | same commit as 8 |
| 11 | `scripts/verifyStaleness.cjs` | **new** | same commit as 8 |
| 12 | `package.json` | `verify:staleness` + chain tail | same commit as 8 |
| 13 | `RAMA_AGI_MASTER_SPEC.md` | **ledger rows + Section 28 approval anchors** — written by master or on master's instruction, **not by this tranche's code** | separate |

Order matters: 1–2 first (the invariant suite must be green before anything claims to guard it); 3–7
second, with `--record-baseline` run **after** 1–2 land **so the tripwire's structural check has a file to
read** — not to capture `verifyInvariants.cjs`'s bytes, which D8 deliberately does not digest (finding 17
corrected the rationale, not the ordering); 8–12 last, so AC17 — the tripwire exiting 0 on the R3 commit —
is a real proof that R3 did not touch the core.

**Baseline maintenance, stated so a later session does not have to guess** (D8/M11): extending
`verifyInvariants.cjs` needs **no** approval and **no** baseline refresh — it is guarded structurally.
Editing `scripts/verifyLoyaltyTripwire.cjs`, any of the three loyalty files, or `capabilities.json`'s
tier-0 projection needs an approval entry whose `ledgerRef` master has placed in Section 28, and then
`--record-baseline --force`, which will refuse until that approval validates.

Verification before each commit: `node --check` on every `.cjs`; `node scripts/verifyInvariants.cjs`;
`node scripts/verifyInvariants.cjs --self-test`; `node scripts/verifyLoyaltyTripwire.cjs`;
`node scripts/auditRenderer.cjs`; `npm run verify`. `vite build` is **not run** and is not claimed. Push
to both `dev` and `source`.

**Suite count:** 22 → 24 after commit 3, → 25 after commit 8. No existing suite's assertion count changes
(AC20): no existing suite file is edited.

---

## 12. Raised for master — not resolved here

1. **Ten spawn-bearing modules start child processes without consulting `resourceOrchestrator.admit`**
   (§4, I10). Measured: 11 spawn-bearing modules, 1 admitting in-file, 3 admit call sites. Includes
   `terminal` (a full shell), `selfBuildPipeline` and `updateChannel` (detached installers) and
   `aiProcess` (the engine). The row records and pins them; closing them changes behaviour on ten paths.
   Capability-versus-loyalty tradeoff, master's call. *(The first iteration said eight. That was wrong.)*
2. **Two real I12 breaches in shipped renderer code** — `Agents.jsx:270`, `consciousness.js:188` (§4,
   I12). Counted-baseline now; a two-line `.jsx` edit would remove them, which is outside R4.3.
3. **One unguarded top-level require of an optional dependency** — `server/routes/system.cjs:5` requires
   `systeminformation`, and `server/index.cjs:48` requires that route module at top level with no guard,
   so an absent optional module stops the API server from booting. `startupDoctor` lists
   `systeminformation` as "absent — running on the fallback", which is true inside `sysinfo.cjs` and not
   true for this route. Recorded by I11's inventory; the fix is a `safeRequire`-style guard in
   `server/index.cjs`, which is a server behaviour change and so master's call.
4. **`proposals.KINDS` is not frozen, and a consumer adds a sixth kind at load.**
   `resourceResearchEngine.cjs:53` writes `proposals.KINDS.RESOURCE = 'resource'` and then registers an
   applier for it (`:260`). I6's row pins the exported table and names the run-time mutation on every run.
   Freezing `KINDS` would change `proposals.cjs`, which is in `PROTECTED_FILES`, so it is raised rather
   than done.
5. **Section 28 names `authCore.mintKey` for I5**; the module exports `issueAccessKey` and three
   `keygen*` functions, and `mintKey` is internal (§4, I5). The row asserts the real behaviour and that
   `mintKey` still exists internally. **The spec is not edited.**
6. **Section 28's I15 says tampering on disk "is reverted on unseal"**, and `nucleusSealer` does call
   `guard.restore(nucleus)`, so the wording holds — but the evaluation's §9.1 questions whether a silent
   repair is the right behaviour versus a reported one. Raised, unchanged.
7. **`releaseChannel` exports `cutRelease` and `bumpSemver` directly**, so the `release.cut` gate lives
   only in the IPC handler (§4, I17). No external caller exists today and the row pins that at zero;
   moving the gate inside `cutRelease` would be a behaviour change to a tier-0 path.
8. **Editing the tripwire itself requires an approval record** (D8). Deliberate: it is a small file with
   no feature surface. Master should know the friction exists before meeting it mid-fix.
9. **`verifyInvariants.cjs` is guarded structurally, not by digest** (D8). A row's contents can therefore
   be weakened without an approval; `--self-test` catches it when run, and the diff is visible, but it is
   not a build-time refusal. The alternative — digesting it — would make every honest extension of the
   suite a covenant-class approval. The trade is recorded, not hidden.
10. **`start.cjs` stage 1 wiring stays deferred** (requirements assumption 1): a boot that halts on a
    failed invariant has no fallback, which is an I11 decision.
11. **R-L3 is the natural next tranche**, and its first act produces the first approval record this
    tripwire consumes (§6.5). Until it lands, `scripts/*`, `package.json` and `.rama/*` are outside
    `PROTECTED_FILES`, so a proposal can *target* them even though no path removes the check silently.
12. **Where the new suites sit in `npm run verify`** (D7, finding 19). This iteration **appends** them,
    per R1.8, so no existing suite can go quiet because of this tranche — and adds `verify:covenant` so the
    loyalty gate is one short command. The cost is that in a full `verify` run, a failure in an unrelated
    existing suite short-circuits before the covenant verdict is printed. Moving the two to the head of the
    chain inverts the tradeoff: the covenant verdict first, and a bug in the new suites silences 22 suites
    (ledger row 118's failure mode). Both are one-line `package.json` edits. **Master's call; the default
    stays R1.8's append until he says otherwise.** The gate is not affected either way —
    `scripts/beforeBuild.cjs` calls the tripwire directly and throws, and `verify:covenant` reaches the
    verdict unconditionally.
13. **Dropping the `Math.max(1, …)` clamp on the scheduler's staleness budget** (§7, finding 16) changes
    nothing for the two daily tasks that exist today, and it means an hourly task registered later gets a
    two-hour budget rather than a one-day one. That is the behaviour the comment always claimed. Noted
    because it is the only semantic change in this revision that is not purely a correction.

Nothing in this design trades loyalty for capability. Items 1, 3 and 4 are places where the **existing**
code is looser than an invariant implies; each is recorded and pinned rather than silently blessed or
silently closed, and each decision is master's. Item 12 is a reporting-order preference, not a gate
question, and is written down rather than decided here precisely because the first iteration decided it
silently.

---

## 13. Open items to record on completion (requirements' list)

- **R3 was implemented**, with `dependencyAdvisor.review` and `ollamaLibrary.refresh` deferred for the
  reasons in §7.
- **Source-shape-only rows:** I2 (Express needs `node_modules`), I7's in-process half (ESM, text-parsed),
  I8, I9, I10, I11 (partial by nature), I12. **No row is source-shape-only because of a missing native
  dependency** — D6 is withdrawn, and I1, I3 and I14 are `[behavioural+source-shape]` everywhere. I15 is
  behavioural on the guard plus structural on the four chokepoints, because `encryptNucleus` is not
  exported.
- **Weakly covered, by declaration:** I10 and I11 are inventories, not universals (D10); I13 is declared
  un-assertable; I11's "the fallback actually works" half is not mechanised.
- **Spec/code divergences raised:** I5's `mintKey`, I15's "reverted on unseal", I17's directly exported
  `cutRelease`.
- **Not asserted:** `loyaltyCore`'s cooldown expiry (no clock seam, and adding one is a loyalty-core edit
  requiring an approval); the `beforeBuild` packaging path; any renderer build claim.
- **Measured figures to record on implementation:** actual wall clock for both suites, and the
  `--self-test` figure, against NFR3's 10 s.
- **Rows whose verdict narrows under an overlay:** I1, I3, I14 — source-shape half only, by D3's rule
  (finding 11). A later session extending those rows must keep each mutation detectable on the
  source-shape half, or the self-test stops proving anything for them.
- **Decided by master, not by the implementer:** the `verify` chain position (§12 item 12). The
  implementation ships R1.8's append.

---

## 14. Responses to the iteration-2 design review (findings 1–21)

Both HIGH and all twelve MEDIUM findings are **addressed**; six of the seven NITs are taken and the
seventh (19) is answered by following the requirements and handing the preference to master. **Every
finding re-measured true** — unlike the previous round there is no "the review's number was off" column.
The commands used are listed after the tables.

| # | Sev | Response |
|---|---|---|
| **1** | HIGH | **Addressed.** Confirmed in source: `baseDir()` falls back to `path.join(os.homedir(),'.rama-agi')` (`electron/lib/loyaltyCore.cjs:82-87`), `corePath()` is `baseDir()/.loyalty.enc` (`:88`), `describe().present` is `fs.existsSync(corePath())` (`:347`) — so an absence is not a witness of isolation and the first iteration could have sealed into master's home. I16 now writes a probe at `ctx.homeDir/.loyalty.enc`, requires `present === true`, removes it, requires `present === false`, **then** seals; the row cleans its three `.loyalty.*` artefacts in a `finally` so `--self-test`'s clean re-run still probes correctly. D2, §6.1, §8's table and P6's wording are all corrected to stop claiming what `present` cannot say |
| **2** | HIGH | **Addressed, and the row was genuinely vacuous.** Confirmed: `approve(id, user)` is positional (`electron/lib/proposals.cjs:176`), `apply(id, opts)` reads `opts.user` (`:219`), and both `authorise` branches return `{ok:false}` with `I6` in the message (`:43`, `:46`). The two labels are swapped, and each case now asserts its **distinctive** message — `/is a label, not an identity \(I6\)/` for the string branch, `/requires an authenticated user \(I6\)/` for the no-numeric-tier branch, a `capability.deny` match for `{tier:5,name:'g'}`. Deleting the string branch now turns the row red, so AC2 can pass. A second mutation (moving `apply`'s status check above `authorise`) was added |
| **3** | MED | **Addressed, keeping the regress argument.** `--record-baseline` records `approvalsSha256` as a top-level baseline field; a check that finds it changed prints `NOTE approvals file changed — <A> → <B>; <n> entries revalidated` and continues. AC13 is now literally true — the digest is computed, compared and reported — without creating the fixed point a fatal digest would need. No requirements amendment |
| **4** | MED | **Addressed.** `DIGEST_GUARDED` (3 loyalty files + the tripwire), `PROJECTION_GUARDED` (`shared/capabilities.json`), `STRUCTURAL_GUARDED` (`verifyInvariants.cjs`, `package.json`, `beforeBuild.cjs`, the approvals file) and `APPROVABLE = DIGEST ∪ PROJECTION`. Baseline digest keys must equal `APPROVABLE` exactly, both ways, and `approval.path` ranges over the same union; a structural member has no digest entry and cannot be approved |
| **5** | MED | **Addressed by composition, so AC3 needs no amendment.** `PRIORITY_KEY = 'loyalty' + 'Priority'` and the fixture uses `{[PRIORITY_KEY]: […]}`, as does the reordered-priority mutation input. A computed key is the same property name, so `inspect` behaves identically, and the only whole-token occurrences left are the forbidden-key list and the expected-message regex. Deriving `CONFORMING` from `COVENANT` stays rejected for H5's reason |
| **6** | MED | **Addressed.** One depth-8 forbidden-key walk is applied to the return value of **every** export I16 invokes — all eleven callables, not five. Primitives and `undefined` pass trivially, so the uniform rule is free; today's returns are enumerated in the row (`sealCore` → `{ok,version,bytes}`, `openCore` → `{ok,version}` or the cooldown refusal, `lock` → `undefined`, and so on) precisely because a clean return is the gap a future change would use |
| **7** | MED | **Addressed, and the measurement corrected.** `route:` occurs **19** times in `src/config/registry.js` — the 18 `PAGES` entries plus `return { route: page.route, page };` at `:233` — re-measured here. The row now bracket-matches `export const PAGES = [` (`:34`, closing `:197`), defines an entry as a top-level `{…}` inside that span, and asserts 18 of each of the six fields **within the span**, noting that occurrences outside it are expected |
| **8** | MED | **Addressed.** `keyedStringLiterals(raw, code, span, key)` is added to D1a, and I17 narrows twice: `callsWithin(span,'sched.register') === 2` (kept — verified correct), then `blockAfter` each call and read that block's single `name:` literal. Confirmed why the unkeyed form is red on HEAD: `registerRefresh`'s span also holds `'models.add-key'`, `'self-modify.view'`, `'./lib/http.cjs'`, `'./lib/ollamaLibrary.cjs'`, both `label:` strings and the nested `runDependencyReview` helper |
| **9** | MED | **Addressed.** `exportedNames` now reads all three forms — object literal, `module.exports.<name> =`, and a bare `module.exports = <ident>` reported as `default:<ident>`. I2's expected surface is `{default:'router', requireLocalToken, TIERS, can}`. Confirmed that `server/routes/auth.cjs:111-114` is the only file among those the rows touch that uses the assignment form; the other five all use `module.exports = {` |
| **10** | MED | **Addressed.** Confirmed the order in `electron/lib/authCore.cjs:672-684`: `findById` → `User not found` (`:675`) → master-immutable (`:676`) → tier floor (`:679`). The `setUserTier` sub-case now seeds **both** accounts (`m1` at tier 0, `u2` at tier 3) with a throwing `putUser`; the all-throwing adapter is kept only for `createUser`, whose refusals precede any store call (`:598-606`). While verifying this, one further trap was pinned: the message dash is **U+2013**, so the row writes `/Tier must be 1\u20135/` rather than a hyphen |
| **11** | MED | **Addressed with one rule in two places.** `ctx.setOverlay()` is the only overlay mutator; it purges the cache **and** clears `ctx.kdf`. `kdfFixture(ctx)` returns `null` when `ctx.overlay` is non-empty, so I1/I3/I14 take their overlay verdict from their source-shape halves alone, and I1's mutation note is corrected to "red on the source-shape half". I16's behavioural half *does* run under an overlay — its KDF is `loyaltyCore`'s 4096-round PBKDF2, not `cryptoCore`'s argon2 path — which is now stated rather than left to inference |
| **12** | MED | **Addressed, all four re-read.** `authCore` tier floors are `:307` / `:605` / `:679`; the scheduler tasks register at `electron/main.cjs:551` and `:565`; `release:cut` is `electron/lib/releaseChannel.cjs:198`; the existing stub is `scripts/verifyEngineDiagnosis.cjs:29-37`. §4's preamble now states that **no row locates anything by line number** — every span comes from `functionBody`, `blockAfter` or a bracket-matched declaration, and the IPC handler is fetched by channel name — so a stale figure is a documentation slip, never a broken assertion |
| **13** | MED | **Addressed, no new module.** Confirmed `warnOnce` exists nowhere in the tree. Each consumer gets a module-local `let _stalenessWarned = false;` and a six-line `stalenessFor` whose `catch` warns once and returns `null`, written out in §7. Duplicated on purpose: a shared helper would itself need the same absence guard, and R3.0 gated one new module, not two |
| **14** | MED | **Addressed.** Both invalid-budget branches are fully specified: with a parseable `asOf` → `{asOf, days:<floored age>, stale:true, neverFetched:false, budgetDays:null, warning:'the staleness budget for <label> is not a positive number, so age cannot be judged'}`; with no `asOf` → the `neverFetched` shape with `budgetDays:null`. The age is reported when measurable, so AC15's "`neverFetched` never coexists with a numeric `days`" holds in both |
| **15** | NIT | **Taken.** Confirmed `status()` returns `{running, tasks:[…]}` (`electron/lib/refreshScheduler.cjs:233-256`, `running` at `:236`). `running` is in the frozen pre-R3 fixture, which now covers thirteen keys: one top-level plus twelve per task |
| **16** | NIT | **Taken — the clamp is dropped.** `budgetDays: (intervalMs * 2) / 86_400_000`, unclamped, because `describe` accepts fractional budgets and the clamp only meant "two intervals" above 12 h. Moot for the two daily tasks today; recorded in §12 item 13 as the one semantic change in this revision that is not a pure correction |
| **17** | NIT | **Taken.** §11 now reads "so the tripwire's **structural** check has a file to read". The ordering is unchanged; the rationale no longer implies a digest D8 deliberately does not take |
| **18** | NIT | **Taken.** I12(c) pins the count of **non-exempt** marker lines at **2** — the two `KNOWN_MARKERS` breaches — and reports the four-line `comments`-view total as a `NOTE`. An honest new TODO inside `astEngine.cjs` is now exempt in fact as well as in intent |
| **19** | NIT | **Taken by following R1.8: the suites are appended.** D7 is rewritten. Prepending would have made a bug in the new suites silence 22 existing suites, which is ledger row 118's mode and AC20's guard, and master never accepted the reorder. To keep the loyalty verdict one command away, `verify:covenant` runs the tripwire then the invariant suite; `beforeBuild` still calls the tripwire directly and throws, so the gate does not depend on chain position. The head-versus-tail preference is raised as §12 item 12 rather than decided here |
| **20** | NIT | **Taken.** One adoption shape for both consumers: a single nested `staleness` key, no flat duplicates. `verifyStaleness.cjs` asserts that `staleness` is the **only** added key on either surface, so the one-vocabulary rule is checked rather than trusted |
| **21** | NIT | **Taken.** Every row's `files` entries are repo-relative; D1a lists the 23 paths and all were confirmed present at `8c1c9ee` (`electron/` for `sessionManager`, `cryptoCore`, `dataStore`, `main`, `nucleusSealer`, `resourceOrchestrator`; `electron/lib/` for the rest). P5 resolves them as `path.join(ctx.root, rel)`, the same form `ctx.read` takes |

**Measurements run while writing this revision** (worktree `.worktrees/model-eval`, HEAD `8c1c9ee`,
PowerShell): the `loyaltyCore.cjs:78-95` and `:340-379` listings; `Select-String` for `present` in
`loyaltyCore.cjs`; `proposals.cjs:36-60` and `:174-183`; `Select-String` for
`Tier must be|SUPERADMIN|User not found|immutable` in `authCore.cjs`; `authCore.cjs:593-610` and
`:666-687`; `main.cjs:536-585`; `releaseChannel.cjs:193-208`; `verifyEngineDiagnosis.cjs:24-41`;
`auth.cjs:105-116`; the `route:` count and `export const`/`^]` positions in `registry.js`;
`refreshScheduler.cjs:231-260`; a `Test-Path` sweep over all 23 row paths; and `Select-String` for
`^module\.exports` across the five object-literal modules.

---

## 15. Responses to the iteration-1 design review (retained for the record)

Kept so a cold session can see why D6 was withdrawn, why the inventories are counted, and which of the
first round's figures were corrected. Superseded wherever §14 revisits the same ground.

### HIGH

| # | Response |
|---|---|
| **H1** | **Addressed.** D6 is withdrawn (§2). Re-measured: `cryptoCore.cjs:76-97` falls back to `crypto.pbkdf2(…600000…'sha512')` and `authCore.cjs:72` returns `null` and takes a scrypt branch. The behavioural halves of I1, I3 and I14 now run unconditionally and the source-shape halves stand as independent assertions; labels carry no environment clause; §12's old item 3 is gone, replaced by the measured KDF cost in §1 and §10 (which is also M12's answer) |
| **H2** | **Addressed.** P3 now allows a named set: `CACHE_ALLOWED` = `argon2`, `@phc/format`, `node-gyp-build` — measured as exactly the three packages present in `require.cache` after a full behavioural run, i.e. argon2 **and its own dependency closure**, which the finding's one-entry list would have missed. Any other `node_modules` package fails P3, and the run prints which KDF executed |
| **H3** | **Addressed.** D3 is rewritten as a rebase rule with the concrete `Module` construction (`new Module(repoFile)`, `filename`, `paths` from `_nodeModulePaths`), applied when a relative request's parent lies under `ctx.tmp`. Fixture **S1** proves it: the sibling must load from `ctx.root`. Verified the sibling requires that made this necessary — `loyaltyCore.cjs` → `./loyaltyGuard.cjs`, `proposals.cjs` → `./capability.cjs` and `./loyaltyGuard.cjs` |
| **H4** | **Addressed.** Verified the double call (the restore branch after a failed `verifyPasscode`). I14's table now requires `cryptoCore.unlock(oldPasscode` **×2** and `cryptoCore.secureDelete(` ×2, the other seven tokens ×1, with `orderWithin` over first offsets and the two load-bearing pairs asserted separately by name |
| **H5** | **Addressed.** Verified `COVENANT` carries `firstPriority`, not `loyaltyPriority`, so the old fixture violated two terms. I15 now builds `CONFORMING` from literals, asserts it passes `assertIntact` as a precondition, then mutates one term per case and matches the message `inspect` actually produces — the six regexes are quoted from `loyaltyGuard.cjs:88-108` |
| **H6** | **Addressed.** D9: `--force` may only re-record digests that already validate, refuses and writes nothing otherwise, and the write is all-or-nothing. Added as §6's fourth obstacle and as acceptance criterion AC-T6 |
| **H7** | **Addressed, with the inventory re-measured from scratch.** The detector is now operational — a file is spawn-bearing when it *requires* `child_process`/`node:child_process`/`node-pty` — which excludes `instanceManager`'s local `function spawn` and `regex.exec` by construction. The table is written out in full: **11 spawn-bearing files, 13 child-process call sites plus one PTY site, 1 admitted, 3 admit callers**. `astEngine.cjs:168` and `projectScaffold.cjs:243` are present, `voiceEngine`'s three sites are counted, and `terminal.cjs:54` (`pty.spawn`) is included — a site the review's own `child_process`-only re-measurement also missed. The figure raised to master is corrected from eight to **ten**. No exemption is invented: each unadmitted entry carries a description of what it starts, and the classification is master's |

### MEDIUM

| # | Response |
|---|---|
| **M1** | **Addressed.** `MARKER_RE = /\b(TODO\|FIXME\|HACK\|XXX)\b/` is a frozen constant; measured **6 raw lines / 4 comment-view lines** at `8c1c9ee`, enumerated in §4; the row asserts on `comments` and the plural "TODOs" is documented as deliberately not a marker. Both `KNOWN_MARKERS` entries confirmed |
| **M2** | **Addressed.** I11's table is now derived and enumerated: 11 optional dependencies read from `startupDoctor.RUNTIME_OPTIONAL` (exported, length asserted), all **22** require sites classified `try` / `lazy` / `safeRequire` / `unguarded` with every site listed, plus the two measured `{file, replacedSymbol}` pairs for the `fitContent` half. The label states the coverage |
| **M3** | **Addressed.** `loadCatalog`, not `read`; all **seven** keys in the AC16 fixture; `now` is a `Date` and the conversion `now.getTime()` is stated at the call site. `useStore` noted as the test seam |
| **M4** | **Addressed.** `stale` is computed at millisecond resolution, `days` is floored for display only, and the strictly-greater boundary is preserved — so `loadCatalog().stale === loadCatalog().staleness.stale` holds and there is still one definition of stale |
| **M5** | **Addressed.** The adapter and seed are written out (`listUsers`, `putUser`, `readMeta`, `writeMeta`); `RECORD_ALLOWLIST` is given explicitly; rotation is asserted as "different `key` **and** different `keyHash` across two calls", with the absence of an exported validator stated rather than worked around |
| **M6** | **Addressed.** The preamble is `kdfFixture`: `init(dataDir)` then `masterUnlock(GOOD, dataDir, 'ua')` with `dataDir = dataStore.getDataDir()`, which the electron stub points at `ctx.homeDir/data`. Measured end to end: the refusal is `Current passcode is incorrect` and `rama.salt` survives. Sharing one fixture across I1/I3/I14 is also M12's mitigation |
| **M7** | **Addressed.** I2 now asserts `router.all(` appears exactly twice, that each `router.all` handler body contains `status(501)`, that the single `router.get(` (`/tiers`, `:100`) is the only non-501 handler, and that the file's export surface is exactly `router` + `requireLocalToken` + `TIERS` + `can`. Mutation (b) rewrites a `router.all` handler to a 200, which is the non-vacuity proof |
| **M8** | **Addressed.** `{ok:false, cooldown:true, error:/cooling down/}`, quoted from `cooldownRefusal()`. The unexported `MAX_ESCALATION` and the deliberate literal `8` are stated |
| **M9** | **Addressed then, SUPERSEDED by finding 1.** The one-sided `describe().present === false` precondition was not a witness of isolation; I16 now uses the two-sided probe. `FIXTURE_CORE`, `SEAL_PASS` and P6 stand as written |
| **M10** | **Addressed.** The `stats().appliers` assertion is gone. I6 asserts on source: the five measured `registerApplier(` sites as a frozen baseline, the single definition at `proposals.cjs:85`, no registration naming `KINDS.DEPENDENCY`, and the exported `KINDS` key set on a fresh require. Re-measuring also surfaced `resourceResearchEngine.cjs:53` mutating `KINDS` at load — now asserted and raised (§12 item 4) |
| **M11** | **Addressed, by the second of the two options.** `verifyInvariants.cjs` is guarded **structurally** (D8) and digests are reserved for the covenant files and the tripwire. The maintenance rule is written into §5, §6.4, §11 and §12 items 8–9, including what a maintainer does in each case |
| **M12** | **Addressed with measurements, not a promise.** §1 records 776 ms / 427 ms / 210 ms = **1.41 s** of KDF work and a 2.51 s `auditRenderer` spawn; `kdfFixture` shares one derivation set across I1/I3/I14; `--self-test` mutations never target a KDF half. §10 states the projected ≈ 5 s and the rule that exceeding NFR3 is raised with master |
| **M13** | **Addressed.** D1a names ten extractors with signatures and views, including `walkShipped` reading through `ctx.read`, plus `blockAfter`, which re-measurement showed is needed for I3 (`cryptoCore.lock()` appears twice in `masterUnlock`, so the `else if` branch body must be isolated) and for I17's `run:` bodies |

### NIT

| # | Response |
|---|---|
| **N1** | **Corrected.** 21 `scripts/verify*` files: 14 `.cjs`, 7 `.mjs`; the `verify` chain is 23 links = 22 suites + `auditRenderer.cjs`. Decision to write `.cjs` unchanged |
| **N2** | **Corrected** to `server/routes/auth.cjs:35` (`:33` is the comment) |
| **N3** | **Addressed.** I17 asserts per case: `Guest` for tier 5, `SuperAdmin` for tier 1, `This account` for the string-user and absent-user cases, from the measured `tierLabels` |
| **N4** | **Addressed.** The suite header documents the three categories in which a covenant token may appear, and I15's mutation pattern is composed from parts |
| **N5** | **Addressed.** I8 adds the `raw`-view quoted forms for `.json` files other than `shared/capabilities.json`, with its own mutation |
| **N6** | **SUPERSEDED by finding 2 — the labels were backwards.** `approve(id,'master')` is the string branch and `approve(id,{user:'master'})` is the no-numeric-tier branch, because `approve(id, user)` is positional. Both cases are kept, correctly labelled, and each asserts its distinctive message |
| **N7** | **Addressed.** `SCAN_FLOOR = 150`, with the measurement recorded: 158 files under the four shipped directories, 156 with a code extension (78 `.cjs`, 43 `.jsx`, 33 `.js`, 2 `.json`) |

### Where the review's measurement needed correcting

Recorded so a later session does not re-derive from the review alone:

1. **M1's "eight marker lines"** is the count without a word boundary; with `\b` — which is the detector
   this design pins — it is **six**. Both counts are now in the document, with the two prose lines named.
2. **H7's inventory**, while right that the first iteration's was wrong, is itself short: it re-measured
   `child_process` only, so it omitted `electron/ipc/terminal.cjs:54` (`pty.spawn`, reached through
   `require('node-pty')`) and `electron/ipc/system.cjs:11-13` (`exec` bound then `promisify`d, so no
   `exec(` call appears). The detector is therefore defined at **require** level, not call level, and the
   corrected inventory is 11 files, not 9 and not 11-with-different-members.
3. **N2's sibling claim** was checked both ways: `server/routes/auth.cjs:35` is correct, and the
   first iteration's `:33` is indeed the comment line.

