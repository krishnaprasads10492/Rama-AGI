# Design review (round 3) — `docs/research/ollama-cloud-design.md`

Reviewed fresh, without the context that produced the document. Design under review is at
worktree `.worktrees/ollama-cloud`, `HEAD = 4fbe246` (`feat/ollama-cloud-api`); the design
file is untracked at that HEAD, alongside the round-2 review it answers.

**Verdict: CHANGES_REQUESTED — 5 HIGH, 6 MEDIUM, 4 NIT.**

The architecture is sound and I am not asking for any of it to be revisited: the separate
`electron/lib/ollamaCloud.cjs` transport, the `ollama-cloud/<api-name>` id namespace, the
frozen two-direction name table with the zero-calls refusal, the transport-owned
`egressBoundary` payload gate with the classification decided once above backend selection,
the concurrency slot inside `resourceOrchestrator`, refuse-on-missing-row made safe by the
every-provider-has-a-row assertion, the capability key raised rather than added, and the
dummy-key leak sweep as the centrepiece all stand. Every security property the step brief
weights was checked and the document's *intent* is correct on all of them.

What blocks is mechanical. Five of the specified pieces **cannot execute as written** — one
of them is the HTTP call itself, one is a self-test case with no file to plant into that
would turn `npm run audit` red on the first commit, one is a `diagnose()` edit that is a
syntax error, one is the assertion the document itself calls *"the one assertion that proves
the feature is reachable on the target machine"*, and one is the renderer boundary at which
every field that makes absence honest is silently dropped. That last one matters most
against the brief: **ABSENT-not-BROKEN and which-path-served-it are both true of the IPC
response and false of anything master can see.**

No finding below asks for a different design. Each names the line, states what happens when
it runs, and gives the replacement.

---

## Findings

### HIGH 1 — The specified send call throws before a byte leaves, and the line contradicts the structural assertion the whole egress guarantee rests on

**Where.** §2.5 step 7, and §12(g).

§2.5 step 7 specifies:

```js
net.request(`${base}/api/chat`, { method: 'POST', body: gate.body,
  headers: { 'Content-Type': 'application/json', ...authHeader() }, timeout, retries: 1 })
```

Two independent problems with that one line.

**(a) `gate.body` is an object and `request()` requires a string.** `net` is
`electron/lib/http.cjs` (verified: `modelRouter.cjs:11` is
`const net = require('../lib/http.cjs')`, and the design follows `customChat`'s idiom). In
`http.cjs`, `request()` does `if (body) finalHeaders['Content-Length'] = Buffer.byteLength(body)`
(L112) and later `if (body) req.write(body)` (L141). **`Buffer.byteLength({...})` throws
`TypeError: The "string" argument must be of type string or an instance of Buffer or
ArrayBuffer`.** And `gate.body` *is* an object: §12(g) asserts "with a valid envelope,
`gate.body` carries `model`, `stream: false` and a `messages` array". So every cloud chat
throws inside `request()` on the first attempt, is caught by `request()`'s own `catch`,
burns both retries, and returns `{ ok: false, status: 0, error: '...' }` — which §8 row 14
reads as `offline: true`. The feature would report the network as down on a working machine.

**(b) The line is forbidden by §12(g).** §12(g) asserts, verbatim: *"`ollamaCloud.cjs` source
contains no `JSON.stringify` and **no `body:` assignment**; the only serialisation in the
cloud path is inside `egressBoundary.assemble`."* `body: gate.body` is a `body:` assignment
in `ollamaCloud.cjs`. The suite fails on the line the design specifies, and the cheap way
out — deleting or loosening that assertion — removes the only thing standing between this
design and a second body constructor. §11.10 names that structural property as the *entire*
present-day value of `egressBoundary`.

**Fix.** Use the `post`/`get` helpers, which do the serialisation **inside `http.cjs`** and
merge caller headers over the base (verified, `http.cjs` L177–L186: `post()` stringifies a
non-string body and spreads `opts.headers` over `{'Content-Type':'application/json'}`):

```js
// §2.5 step 7. net.post serialises INSIDE http.cjs, so ollamaCloud.cjs contains no
// JSON.stringify, no `body:` key, and no second body constructor — §12(g) holds as written.
// gate.body is passed by reference and never amended.
const res = await net.post(`${base}/api/chat`, gate.body,
  { headers: authHeader(), timeout, retries: 1 });

// §2.6 listModels
const res = await net.get(`${base}/api/tags`, { headers: authHeader(), timeout: 15000, retries: 1 });
```

And restate §12(g)'s structural clause so it describes what it now guards:

> `ollamaCloud.cjs` contains no `JSON.stringify`, no `body:` key, and no call to
> `net.request`; the only outbound calls are `net.post` / `net.get`, each passing
> `assemble`'s `body` by reference. `egressBoundary.cjs` likewise contains no `require` of
> `http.cjs`.

Add one positive assertion to §12(h): a dummy-key success path returns `ok: true` with
`content` — because a throw inside `request()` currently reads as `offline`, and §12(h) as
written asserts only that each failure row carries its flag and never `ok: true`, which that
bug satisfies.

---

### HIGH 2 — `I-SECRETS-planted-md` has no file to plant into, so it turns `npm run audit` and `verify:covenant` red on the first commit

**Where.** §12.2(c), §14's `verifyInvariants.cjs` row, §131.3.

§12.2(c) adds a second self-test case that *"plants the same shape in a tracked `.md` file
under `electron/` or `src/`"*, and says the case exists to assert the per-extension view
choice.

**Measured in this session:**

```
Get-ChildItem -Recurse -Path electron,src,server,shared,scripts -Include *.md   → 0 files
```

There is no `.md` file anywhere in the five trees. The extension census over the exact file
set §12.2(b) specifies is **194 files** — which confirms §1.12 fact 7's count precisely —
split `.cjs 103`, `.jsx 43`, `.js 36`, `.mjs 9`, `.json 3`, **`.md 0`**. The three `.json`
files are all under `shared/` (`capabilities.json`, `loyalty-tripwire.json`,
`resourceCatalog.json`), and two of those are protected files.

So `pick` returns `undefined`, and `selfTest()` does
`if (!rel) { r.fail(\`${m.id}: no file to mutate\`); continue; }`
(`verifyInvariants.cjs` L1050–L1052). `I-SECRETS-planted-md` fails, the `SELF` row goes red,
and **both `npm run audit` and `npm run verify:covenant` fail from the first commit** — the
same "red on the first commit, so the check gets disabled" failure mode §12.2(b) was written
to avoid, arriving through the case added to defend it.

And adding a `.md` file would not rescue it. `selfTest()` builds its sandbox from

```js
const everyFile = [...new Set([ ...INVARIANTS.flatMap((i) => i.files), ...walkShipped(ROOT),
  'package.json', 'electron/lib/capability.cjs', 'shared/capabilities.json' ])];
copyInto(ROOT, dest, everyFile);
```

and `walkShipped`'s extension set is `{'.cjs','.mjs','.js','.jsx'}` (verified L217) — a `.md`
file is not in it. `copyInto` silently skips what it is not given, then
`const before = fs.readFileSync(target, 'utf8')` (L1056) throws `ENOENT` **outside**
`runRowSilently`'s `try`, crashing the harness rather than failing a check.

Related, and worth one sentence in the document: with zero `.md` files in those trees, the
`.md` half of `walkForSecrets` scans nothing at all, and `.json` scans three files. The `.md`
coverage that actually matters (`docs/`) comes from §12.3's `git ls-files` sweep, which
applies **only** the prefix matcher.

**Fix — pick one and write it in.**

**(a) Preferred: assert the view choice in `scannerSelfCheck()` instead of `MUTATIONS`.**
`verifyInvariants.cjs:244` already exists for exactly this — proving the scanner on synthetic
strings before any row trusts it — and it needs no file on disk:

> **Note added at build time:** the fixture literal below is written as `SK + TAIL` rather
> than contiguously. This file is tracked, and `verifyOllamaCloud.cjs`'s tracked-file sweep
> applies the known-prefix matcher to every tracked text file — so a contiguous
> prefix-shaped literal here would make the review document a hit for the scan it is
> reviewing. Renaming the literal is the prescribed move; allow-listing it is not.

```js
// scannerSelfCheck(), beside the existing views() cases. The per-extension view rule is the
// thing that can make the scan permanently green, so it is proven on strings, not on a
// planted file — there are no .md files under electron/ or src/ to plant into.
const SK = 'sk' + '-';
const TAIL = 'A1b2C3d4E5f6G7h8I9j0';
r.check('a .md body is scanned RAW, so a // in a URL does not blank the line after it',
  secretHits('x.md', `see https://x.test // ref\nkey: ${SK}${TAIL}\n`).length === 1);
r.check('a JS string literal survives the nc view',
  secretHits('a.cjs', `const apiKey = '${SK}${TAIL}';`).length === 1);
r.check('and a JS comment does not, so master\u2019s own notes are not hits',
  secretHits('a.cjs', `// example: ${SK}${TAIL}`).length === 0);
```

Then `MUTATIONS` keeps exactly one new case, `I-SECRETS-planted`, whose target
(`electron/**/*.cjs`) *is* copied by `walkShipped`. §14's count drops accordingly, and the
"thirteen existing cases become fourteen" statement replaces "fifteen".

**(b) If a planted file case is wanted:** target `shared/resourceCatalog.json` — the only
non-protected `.json` in the trees — rename the case `I-SECRETS-planted-json`, and add that
path to the `I-SECRETS` row's `files` array, because `INVARIANTS.flatMap(i => i.files)` is
the *only* route by which a non-`walkShipped` extension reaches the sandbox.

Either way, state in §12.2(b) that `.md` currently matches zero files inside the five trees
and that `docs/` is covered by §12.3's prefix sweep alone — so a later session does not read
the extension list as coverage it is not.

---

### HIGH 3 — The only renderer caller drops every field that makes absence honest and the path visible

**Where.** §3.4(a), §12(g3), §14's `src/services/ramaClient.js` row ("2 lines").

The design correctly identifies `src/services/ramaClient.js` as the only `models.chat` caller
in the tree and threads `user` through it. But it scopes the change to `user` only, and the
function as it stands discards everything else this tranche adds (verified, L19–L37):

```js
if (res?.ok) {
  return { ok: true, sessionId: ..., message: { role:'assistant', content: res.content },
           model: res.model, fallbackFrom: res.fallbackFrom, usage: res.usage };
}
// modelRouter returned an error — surface it, don't silently fall back
return { ok: false, error: res?.error || 'Model router returned no content' };
```

So `unconfigured`, `remedy`, `failures`, `gateError`, `path`, `endpoint`, `via` and
`credentialSource` **never reach a renderer**. Measured against the step brief:

- *"the absent-key state must report ABSENT/UNCONFIGURED, never a silent fallback"* — the
  IPC response does. Master sees `{ ok: false, error: 'no Ollama API key is stored' }` with
  the one actionable sentence (`remedy`) deleted one function above him. §3.4(b) went to
  real trouble to stop the chain saying `All models failed`; the replacement text arrives
  and is then thrown away.
- *"which path served a request must be visible"* — `path: 'cloud' | 'local'`, `endpoint`,
  `via` and `credentialSource` are all built, asserted in §12(e), and then dropped. §2.5's
  closing claim that *"which path served a request is visible to master, not inferred from a
  model name"* is false as specified.
- §3.4(b)'s *"the substitution and its cause are both declared"* — `fallbackFrom` survives;
  `unconfigured`, the cause, does not.

§12(g3) asserts only that the call object includes `user`, so the suite passes while all of
the above is true.

**Fix.** Specify the forwarding, and widen §14's row from 2 lines to ~10:

```js
// src/services/ramaClient.js — ramaChat.send. Everything this tranche added to the
// models:chat response is forwarded, because a field master cannot see is a field that does
// not exist. `remedy` on the failure path is the one actionable sentence in the whole
// absent-key story.
send: async ({ messages, provider, model, sessionId, taskType, user }) => {
  if (typeof window !== 'undefined' && window.rama?.models?.chat) {
    try {
      const res = await window.rama.models.chat({ messages, model,
                                                  taskType: taskType || 'general', user });
      if (res?.ok) {
        return { ok: true, sessionId: sessionId || `s_${Date.now()}`,
                 message: { role: 'assistant', content: res.content },
                 model: res.model, fallbackFrom: res.fallbackFrom,
                 unconfigured: res.unconfigured ?? null,
                 path: res.path ?? null, endpoint: res.endpoint ?? null,
                 via: res.via ?? null, credentialSource: res.credentialSource ?? null,
                 usage: res.usage };
      }
      return { ok: false, error: res?.error || 'Model router returned no content',
               unconfigured: res?.unconfigured ?? null, failures: res?.failures ?? null,
               remedy: res?.remedy ?? null, gateError: res?.gateError ?? false };
    } catch (err) { return { ok: false, error: `IPC error: ${err.message}` }; }
  }
  ...
}
```

Add to §12(g3): a structural assertion that `ramaClient.js`'s **failure** return object
includes `remedy` and `unconfigured`, and that its **success** return includes `path`. And
name, in §14, the one renderer surface that renders `remedy` — `src/pages/Chat/Chat.jsx`
around its existing `res.ok === false` branch — otherwise the forwarding stops one layer
higher than it did before and the finding re-opens there. One line is enough:

> `Chat.jsx` — where a failed send is reported, append `res.remedy` when present, so an
> absent key reads as *"no Ollama API key is stored — Models → Cloud → Ollama Cloud → Add
> key (unlock the vault first)"* rather than as a bare error.

---

### HIGH 4 — `--diagnose`'s specified probe cannot be awaited: `diagnose()` is synchronous, and `probeLocal` does not exist

**Where.** §7.3, §14's `start.cjs` row.

§7.3 specifies, inside `diagnose()`:

```js
const daemonUp = await probeLocal('127.0.0.1', 11434, 500);   // 500 ms, loopback only
```

Verified in the worktree:

- `start.cjs:318` is `function diagnose() {` — **not `async`**. `await` inside it is a
  `SyntaxError`, which `node --check start.cjs` catches, so this fails the project's own
  verification bar immediately.
- `diagnose()` has two call sites, neither awaited: `start.cjs:1474`
  (`let { defects, report, degraded } = diagnose();`) and `start.cjs:1514`
  (`const after = diagnose();`). Both sit inside `async function main()` (L1451), so they
  *can* be awaited — but turning `diagnose()` async changes its return type from an object
  to a Promise and both destructures break until changed. §14's `start.cjs` row lists "three
  `diagnose()` report lines, a loopback daemon probe, one `degraded` entry **and** one
  `degrade`-severity defect… plus the `.env` warning" and does not mention the signature
  change or either call site.
- `probeLocal` does not exist anywhere in the tree (grepped). Its signature, return type and
  failure behaviour are implied by one call and never stated.

The `.env` warning in the same section is fine — `fs.readFileSync` is synchronous and that is
the part that carries the security value.

**Fix — pick one and write it in.**

**(a) Preferred: drop the probe from `diagnose()`.** Keep `diagnose()` synchronous, keep the
two `add()` lines that need no I/O and the `.env` warning, and let `models:cloud-status`
(§7.1) — which can read the vault and can be async — own daemon reachability. The honest
diagnostic text barely changes:

```js
// start.cjs diagnose() — stays SYNCHRONOUS. Daemon reachability needs a socket, and
// diagnose() has two un-awaited callers (L1474, L1514); making it async to probe a port it
// does not need would change its contract for a line models:cloud-status already owns.
add('Ollama Cloud base', true, `${baseUrl} (default; config.ollamaCloudBaseUrl wins)`);
add('Ollama Cloud credential', true,
    'stored in the encrypted vault; not readable before the app starts — check Models → Cloud');
```

Then `degraded`/`defects` for an absent daemon are raised by `models:cloud-status` or left
to the existing optional-module rows, and §7.3's `if (!daemonUp)` block is deleted.

**(b) If the probe is wanted in `diagnose()`:** make the change complete. State that
`diagnose()` becomes `async function diagnose()`, that **both** L1474 and L1514 become
`await diagnose()`, list both in §14, and specify the helper:

```js
/** Loopback-only reachability probe. Resolves false on ANY error — a diagnostic must not
 *  hang on a firewall and must not characterise a failure it cannot explain. */
function probeLocal(host, port, ms) {           // → Promise<boolean>
  return new Promise((resolve) => {
    const req = http.request({ host, port, path: '/', method: 'GET', timeout: ms },
      (res) => { res.resume(); resolve(true); });
    req.on('error',   () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.end();
  });
}
```

(`http` is already required at `start.cjs:46`, so the design is right that no new import is
needed.)

---

### HIGH 5 — §12(e)'s positive reachability assertion has no seam, and the design names it as the proof the feature works at all

**Where.** §12(e), §10, §2.2's injection seams.

§12(e) asserts:

> with a stub vault holding the dummy key, **no daemon and no other credential,
> `selectModel('general')` returns an id beginning `ollama-cloud/`**

and §10 calls this *"the one assertion that proves the feature is reachable on the target
machine"*. There is no specified way to run it.

`selectModel` lives in `modelRouter.cjs` and reaches the vault through `checkAvailable`,
which calls `getCredential(info.credKey)`. `modelRouter.cjs:10` is

```js
const { getCredential } = require('./credentialVault.cjs');
```

— a **destructured binding captured at load time**. The four seams §2.2 provides
(`useVault`, `useStore`, `useHttp`, `useOrchestrator`) are all on `ollamaCloud.cjs`; none of
them reaches `modelRouter`'s captured `getCredential`, and monkey-patching
`credentialVault`'s exports *after* `modelRouter` is loaded has no effect on that binding.
So the **negative** half of §12(e) is reachable by accident (a locked real vault makes
`getCredential` return `null`), and the **positive** half — the one that proves the feature
is reachable — is not reachable at all.

The same gap governs §12(d) (`models:chat`'s `unconfigured` chain), §12(g2)'s positive case
(*"a master-tier user's cloud request REACHES the HTTP stub"* through **the real `switch`**)
and §12(j) (`ollamaChat` still posts to `localhost:11434`). All four exercise
`modelRouter.cjs`.

One related fact the design should record, because it reads as a contradiction otherwise:
§10 says the suite runs *"with no network and no Electron"*, yet `modelRouter.cjs` →
`credentialVault.cjs:13` → `require('electron')` at module scope. That is survivable, not
fatal — the `electron` npm package's main export is a path **string**, so
`const { app } = require('electron')` leaves `app === undefined`, and `getVaultPath()` uses
`app?.getPath('userData') || path.join(require('os').homedir(), '.rama-agi')` with optional
chaining, so it falls back to the home directory. But it does mean the suite **requires
`node_modules` to be installed** (otherwise the `require` throws `MODULE_NOT_FOUND`), and
that without a stub it would `mkdirSync` under master's home directory and open the path of
his real vault file.

**Fix.** Specify the seam, in §10 and §12(e), as a require-cache stub installed **before**
`modelRouter` is loaded:

```js
// scripts/verifyOllamaCloud.cjs — modelRouter DESTRUCTURES getCredential at line 10, so
// patching credentialVault's exports afterwards does nothing. The seam has to be the require
// cache, installed BEFORE modelRouter is required. This also keeps the suite away from
// master's real vault file: credentialVault reaches `electron` at module scope, and under
// plain Node `app` is undefined, so getVaultPath() would fall back to ~/.rama-agi.
let vaultUnlocked = true, vaultHasKey = true;
const vaultPath = require.resolve('../electron/ipc/credentialVault.cjs');
require.cache[vaultPath] = { id: vaultPath, filename: vaultPath, loaded: true, children: [],
  exports: {
    register() {},
    isUnlocked: () => vaultUnlocked,
    getCredential: (s) => (vaultUnlocked && vaultHasKey && s === 'OLLAMA_API_KEY'
      ? 'test-not-a-real-key' : null),
    setCredentialDirect() {}, deleteCredentialDirect() {},
  } };
const modelRouter = require('../electron/ipc/modelRouter.cjs');   // now vault-stubbed
```

Add to §11.8: *"`verifyOllamaCloud.cjs` requires `node_modules` to be present, because
`modelRouter.cjs` reaches `electron` transitively through `credentialVault.cjs`. It is
specified-not-executed in this workspace for that reason as well as the count."*

And add one assertion to §12(j): with the stub installed, `getVaultPath` is never called —
i.e. no file under `userData`/`~/.rama-agi` is created by the suite. A security suite that
touches the real vault's directory is a surprise nobody wants to discover on master's
machine.

---

### MEDIUM 6 — `_awaitSlot` as specified lets two CRITICAL waiters both take a `maxConcurrent: 1` row

**Where.** §6.3's `reserveSlot` block, §8 row 7b, §12(i).

The specification is an event wait with no re-check:

```js
const got = await this._awaitSlot(provider, waitMs);   // resolves on 'slot:released'
if (!got) return { ok: false, deferred: true, timedOut: true, reason: ... };
return { ok: true, waited: true };
```

`releaseSlot` *"emits a `slot:released` event that waiters listen for"*. With two CRITICAL
requests waiting and one `releaseSlot`, **both** listeners fire, both `_awaitSlot` calls
resolve truthy, and both `reserveSlot` calls return `{ ok: true }` — so `inFlight` reaches 2
on a row whose `maxConcurrent` is 1. That is precisely the free-tier limit the brief says
must be corrected, broken by the mechanism added to honour it. §6.3 says CRITICAL
*"QUEUES at the head"*, but a queue is never specified — only an event — and §12(i) asserts
one waiter, so the suite cannot see it.

**Fix.** Specify a re-check loop with the increment in the same synchronous turn as the test,
so exactly one waiter wins per release:

```js
// One waiter wins per release. An event listener that resolves without RE-CHECKING lets two
// CRITICAL waiters both drive a maxConcurrent:1 row to inFlight = 2, which is the free-tier
// limit this method exists to enforce. The increment happens in the same synchronous turn as
// the test, so there is no await between checking and taking.
async _awaitSlot(provider, waitMs) {
  const limit = Object.prototype.hasOwnProperty.call(API_RATE_LIMITS, provider)
    ? API_RATE_LIMITS[provider] : null;
  if (!limit) return false;
  const deadline = Date.now() + waitMs;
  for (;;) {
    if (limit.inFlight < limit.maxConcurrent) { limit.inFlight++; return true; }
    const left = deadline - Date.now();
    if (left <= 0) return false;
    await this._onceOrTimeout('slot:released', left);
  }
}
```

and state that `reserveSlot` does **not** increment again when `_awaitSlot` returns true (the
loop already did), otherwise the fix double-counts. Add to §12(i):

> two CRITICAL waiters on a held `maxConcurrent: 1` row, then **one** `releaseSlot`: exactly
> one resolves `{ ok: true, waited: true }`, the other is still pending, and
> `API_RATE_LIMITS['ollama-cloud'].inFlight === 1`.

---

### MEDIUM 7 — `assemble({ kind: 'search' })`'s body is never specified, while §5.3 says `webSearch` uses it verbatim and §12(g) asserts a complete body for chat only

**Where.** §5.3's contract, §12(g), §11.3, §11.12.

§5.3 states that `webSearch()` *"calls `egressBoundary.assemble({ kind: 'search', query,
maxResults })` and uses the returned body verbatim"*, and §12(g) adds the positive assertion
that *"with a valid envelope, `gate.body` carries `model`, `stream: false` and a `messages`
array"* — **for chat**. Nothing anywhere says what `body` contains for a search. §11.3 and
§11.12 then admit the hosted-search endpoint path, request body and response shape are
unknown and *"cannot be implemented from this document alone"*.

The result is that the "one constructor" rule is satisfied in letter while the search body's
field names are invented inside `assemble` by whoever writes it, unreviewed — which is the
same outcome §12(g) exists to prevent, moved one function inward. §12(g)'s search assertions
all test **refusals** (private query, bare string, zero calls on both stubs), so an invented
or empty accepted body passes the suite.

**Fix — pick one.**

**(a) Pin a placeholder and say it is one.**

```js
// kind:'search' — PROVISIONAL on §11.3. The classification and the refusal are firm; these
// two field names are not. When the real shape is read, the ONLY permitted change is the
// field names INSIDE this function. Nothing moves to the call site.
if (kind === 'search') {
  return { ok: true, maxLevel, counts: { messages: 0, parts: 0 },
           body: { query: query.text, max_results: clamp(maxResults, 1, 10) } };
}
```

and add to §12(g): an accepted search envelope yields a `gate.body` whose only
caller-derived value is `query.text`, and which carries no `messages`, no `model` and no key
not in `{ query, max_results }` — so a later widening is a visible, reviewed act.

**(b) Defer `webSearch()` from this tranche.** The credential, the admission row
(`ollama-search`), `models:search-web`'s gate-above-backend-selection, the
`browserEngine.searchWeb` extraction and every refusal assertion still land; only the cloud
*backend* waits for §11.3. Given §5.1 already says this tranche builds a backend ahead of its
caller, deferring the one piece the document says cannot be written from itself costs
nothing observable and removes an invented request shape from a security-critical path. If
(b), §5.2's backend order becomes Playwright-or-absent for now and §13.2(3) says so.

---

### MEDIUM 8 — `orchestrator:api-limits` ships the whole row, so the new monthly counters become an ungated renderer surface outside §2.2's discipline

**Where.** §6.2's row shape, §6.3's monthly accounting; the handler is
`resourceOrchestrator.cjs:508`-adjacent.

Verified in the worktree:

```js
ipcMain.handle('orchestrator:api-limits', async () => {
  return { ok: true, data: API_RATE_LIMITS };     // whole object, no capability check
});
```

§6.2 adds `maxConcurrent`, `inFlight`, `monthlyTokenBudget`, `usedTokMonth`, `monthStartedAt`
and a prose `note` to the `ollama-cloud` row, and §6.3 persists the monthly counters to
`dataStore.config.ollamaCloudUsage`. All of it is then handed to any renderer that asks, with
no gate and no projection. `getStatus()` (the other exposure) *does* project explicitly to
`{ used, cap, pct }`, so the two surfaces will now disagree about what a rate-limit row is.

This is not a credential leak — nothing in the row derives from the key — but it is a new
renderer surface the design does not mention, and it contradicts §2.2's own rule that there
be **one** definition of what may be said, with the renderer surface *provably narrower*
(§12.4(7b) asserts exactly that for `models:cloud-status`). A later session reading
`orchestrator:api-limits` will reasonably conclude a rate-limit row is a thing you may expose
wholesale, which is how a `lastKeyPrefix` field ends up there.

**Fix.** Add to §6.2:

> `orchestrator:api-limits` returns `API_RATE_LIMITS` wholesale and is ungated. The rows this
> tranche adds carry no value derived from the credential, so the exposure is acceptable —
> and the rule is written down so it stays true: **no field may be added to any
> `API_RATE_LIMITS` row that derives from a credential value.** `getStatus().apiLimits` keeps
> its explicit `{ used, cap, pct }` projection and gains `inFlight` and `maxConcurrent`;
> `usedTokMonth` and `monthStartedAt` are reported through `ollamaCloud.status()`, which is
> the surface §2.2 freezes.

and to §12(i): no own-property of any `API_RATE_LIMITS` row matches
`/key|token(?!PerMin|_month)|secret|bearer|prefix|hash/i`, and the dummy key from §12.4 does
not appear anywhere in `JSON.stringify(API_RATE_LIMITS)` after a full cloud call.

---

### MEDIUM 9 — The secret matcher's "must contain a digit" discriminator creates a false-negative class, and it is not needed: `!WORDY` alone silences both measured false positives

**Where.** §12.2(b), §131.3, ledger row 151.

§12.2(b) specifies

```js
const WORDY = /^[A-Za-z]+(?:[_-][A-Za-z]+)+$/;
const candidate = s => !WORDY.test(s) && /\d/.test(s) && entropy(s) >= 3.5;
```

and the document presents both discriminators as jointly necessary, repeating in §131.3 and
the ledger row that *"without those two discriminators it is measurably red on the first
commit"*. **Measured in this session against the two strings the design names:**

| String | `WORDY`? | has digit? | rejected by `!WORDY` alone? |
|---|---|---|---|
| `locally-privileged-but-HTTP-reachable` (`src/services/ghostMode.js:130`) | **yes** | no | **yes** |
| `ABSOLUTE_LOYALTY_TO_KRISHNA_PRASAD_SECRET_MATRIX` (`scripts/verifySelfModel.cjs:307`) | **yes** | no | **yes** |

Both are all-letters-and-separators, so `WORDY` matches both and the digit test is doing no
work against either. (The `ghostMode` string is additionally inside a JSDoc block, so the
`nc` view blanks it and it cannot match in any case — which is consistent with §12.2(b)'s
note that `nc` can only match the same or fewer than the raw probe.)

Keeping the digit test therefore buys nothing measured and silently excludes every
digit-free credential — not an exotic case, since plenty of tokens are alphabetic runs and
any 32+ char alphabetic slice of a longer key is one. The design's own rule is *"narrowing
the matcher… is the right move"*, and here the narrowing is unnecessary.

**Fix.** Drop the digit requirement, keep `!WORDY`, and record the measurement so the next
session does not re-add it:

```js
// A credential is not a sentence and not an identifier. Measured over electron/ src/ server/
// scripts/ shared/ (194 files): !WORDY alone yields 0 entropy hits. Both strings that would
// otherwise fire — 'locally-privileged-but-HTTP-reachable' (a comment, so nc blanks it) and
// 'ABSOLUTE_LOYALTY_TO_KRISHNA_PRASAD_SECRET_MATRIX' — are all-letter runs and match WORDY.
// A digit test was considered and REJECTED: it adds nothing against either string and
// silently excludes every digit-free token.
const WORDY = /^[A-Za-z]+(?:[_-][A-Za-z]+)+$/;
const candidate = s => !WORDY.test(s) && entropy(s) >= 3.5;
```

If the digit test is kept instead, say in §12.2(b) that a digit-free high-entropy literal is
a **known, accepted miss** and that the prefix matcher is the only defence for it — because
an unstated gap in a credential scan is worse than a stated one. Correct §131.3 and the
ledger row either way; both currently assert a measurement that does not hold.

---

### MEDIUM 10 — `_tick`'s increment is described as "unguarded" and is not; the real hazard is different and the false sentence is headed for a tracked file

**Where.** §1.12 fact 5, §6.4b's closing paragraph, §131.7, ledger row 151.

All four say `_tick`'s increment is an *"unguarded bracket read"*. Verified at
`resourceOrchestrator.cjs:250`:

```js
if (task.aiProvider && API_RATE_LIMITS[task.aiProvider]) {
  API_RATE_LIMITS[task.aiProvider].usedReq++;
  if (task.estimatedTokens) API_RATE_LIMITS[task.aiProvider].usedTok += task.estimatedTokens;
}
```

It **is** guarded — by truthiness, not by ownership. The hazard is real and in fact worse
than "unguarded" conveys: `API_RATE_LIMITS['__proto__']` resolves through the prototype chain
to `Object.prototype`, which is **truthy**, so the guard passes and `.usedReq++` writes
`NaN` onto `Object.prototype` — prototype pollution affecting every plain object in the
process, from one free-text field in `Resources.jsx`. The prescribed fix (`hasOwnProperty`)
is unchanged and correct.

This matters because §1.12 is the document's own verification record, §131.7 and the ledger
row are **ready-to-paste blocks destined for `docs/research/OLLAMA_CLOUD.md`**, and round 2's
worst finding was exactly this shape: a false statement about the existing code shipping into
a tracked file. A cold session that reads the code and does not find what the design
describes has reason to distrust the rest of §1.12.

**Fix.** Replace the phrase in all four places:

> `_tick` (L250) guards by **truthiness, not ownership**: `API_RATE_LIMITS['__proto__']`
> resolves through the prototype chain to `Object.prototype`, which is truthy, so the guard
> passes and `.usedReq++` writes onto `Object.prototype` — prototype pollution from a
> free-text UI field. `hasOwnProperty` closes it, the same guard `_canRun`, `admit` and
> `recordApiUse` take.

and add to §12(i): after `_tick` runs with `aiProvider: '__proto__'`,
`Object.prototype.usedReq === undefined` — asserted, because the symptom of this bug appears
nowhere near its cause.

---

### MEDIUM 11 — Whether `listModels()` may mutate `MODEL_REGISTRY` is unspecified, and the house pattern says yes

**Where.** §2.6, §11.5, §14's follow-up list.

§2.6 gives `listModels()` a return shape and §11.5 names it as the mechanism that will
*"reconcile"* the thirteen inferred `apiModel` values against the live keyed catalogue.
Nothing says whether reconciliation is report-only or whether it writes the registry.

The ambiguity is not theoretical: both sibling Ollama paths in this file do refresh-and-merge
(verified — `refreshOllamaModels()` rebuilds `discoveredOllama` from the daemon probe, and
`refreshCustomProviders()` at `modelRouter.cjs:86–91` deletes its tracked ids then
`Object.assign`s fresh ones into `MODEL_REGISTRY`). An implementer following the house
pattern would naturally have `models:cloud-list` merge discovered cloud rows into the
registry — at which point rows exist whose `daemonTag` was never in the frozen table, which
is exactly what §4.2's *"`null` for anything not in it — never a derived guess"* forbids, and
`§12(f)`'s per-row assertions (which iterate `CLOUD_TAGS`) would not see them.

**Fix.** One sentence in §2.6 and one in §14:

> `listModels()` is **report-only**. It never writes `MODEL_REGISTRY`, never adds a row, and
> never fills a `daemonTag` the table does not hold — unlike `refreshOllamaModels` and
> `refreshCustomProviders`, which do merge. Reconciling an inferred `apiModel` is a **source
> edit to `CLOUD_TAGS`**, reviewed and committed, not a runtime mutation: the table is the
> authority in both directions and a runtime-added row would have no attested daemon tag.

and to §12(f): `MODEL_REGISTRY`'s set of `ollama-cloud/*` ids is unchanged after a successful
`listModels()` call against the stub.

---

### NIT 12 — Name the HTTP binding in the new module, because `net` reads as Electron's `net`

§2.5 step 7 and §1.2 both write `net.request(...)`. That is correct *in `modelRouter.cjs`*,
where `net` is a local alias (`modelRouter.cjs:11`,
`const net = require('../lib/http.cjs')`), and `browserEngine.cjs:60` uses the same alias.
But `electron/lib/ollamaCloud.cjs` is new, and `net` is also the name of Electron's own HTTP
module — whose `net.request` would be a real I9 breach with no circuit breaker, no 429
backoff and no response cap. Write the binding explicitly in §2.2 so the reader is never
guessing which `net` is meant:

```js
// electron/lib/ollamaCloud.cjs — the ONE client (I9). Named `http`, not `net`, because
// Electron's own `net.request` is a different thing and must never be used here.
const http = injectedHttp ?? require('./http.cjs');
```

§12.2(a)'s asserted specifier `'./http.cjs'` is right as written.

### NIT 13 — `PROVIDER_LINKS` has eight entries at L15–L23, not "six services (L16–L21)"

§1.8 says *"`PROVIDER_LINKS` (L16–L21) maps a `credKey` to `{ label, url, hint }` for six
services"*. Verified: the object spans `src/pages/Models/Models.jsx` L15–L23 and holds
**eight** keys — `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `MISTRAL_API_KEY`,
`GROQ_API_KEY`, `NEWSAPI_KEY`, `ALPHA_VANTAGE_KEY`, `GITHUB_TOKEN`. Nothing downstream
depends on the count; correct it so §1.8 stays trustworthy.

### NIT 14 — Two line numbers are off by one

`ramaChat.send`'s `window.rama.models.chat` call is `src/services/ramaClient.js:22` (the
design says L23 in §1.12 fact 2, §3.4(a), §13.1 and §131.8b(4)), and
`ipcMain.handle('browser:search', …)` is `electron/ipc/browserEngine.cjs:192` (the design says
L193 in §1.7, §1.12 fact 3 and §5.1). Both files are otherwise exactly as described.

### NIT 15 — `.env.example`'s `HMAC_SECRET` placeholder is a high-entropy credential-adjacent literal that only the prefix matcher sees

`.env.example:25` is `HMAC_SECRET=change-this-to-a-random-64-char-string`. It is not a
credential and it would not match the prefix matcher, so nothing goes red — but it is not
`WORDY` either (the `64` breaks the all-letters run), so under the fix in MEDIUM 9 it is a
digit-bearing high-entropy literal on a `secret`-matching line. `.env.example` sits at the
repo root, outside `walkForSecrets`' five trees, and §12.3's tracked-file sweep applies only
the prefix matcher — so it is quiet today by position rather than by design. Worth one line
in §12.2(b) noting that root-level tracked files get the prefix matcher only, so the next
person widening the walk knows what they will hit.

---

## Verified Assumptions

Each read directly out of `.worktrees/ollama-cloud` at `HEAD = 4fbe246` this session.

| Design claim | Status |
|---|---|
| `credentialVault.cjs` exports `register, getCredential, isUnlocked, setCredentialDirect, deleteCredentialDirect` (§1.1) | **confirmed**, L255–L258 |
| the four `ollama/*` seed rows are `credKey: null, type: 'local'` (§1.2) | **confirmed**, L28–L31 |
| `let ollamaBaseUrl = 'http://localhost:11434'` at L71; `httpGet('http://localhost:11434/api/tags')` at L489; `httpPost('localhost', 11434, '/api/chat', body)` at L658 (design says 659) | **confirmed** |
| `httpPost(hostname, port, path, body)` at L706 and `httpGet(url)` at L716 take **no** `headers`; `credentialStatus()` at L745–753 (§1.2, NIT #18 of round 1) | **confirmed** |
| `credentialStatus()` maps every unavailable non-`local` row to `'missing-key'` (§1.11) | **confirmed** |
| `FALLBACK_CHAIN` is **not** in `module.exports` (L755–758) (§1.2) | **confirmed** |
| `chatCompletion`'s `switch` ends `default: throw new Error('Unsupported provider: …')` (§1.2) | **confirmed**, L548 |
| `checkAvailable` ends `if (!info.credKey) return true; return !!getCredential(info.credKey)` (§1.2) | **confirmed**, L478–L480 |
| `customChat` builds a URL, sets `Authorization: Bearer`, and calls the shared client with a **stringified** body (§1.2's cited precedent) | **confirmed**, L562–L572 |
| `lib/http.cjs`'s `request(url, { method, headers, body, timeout, human, retries, maxSize })` merges `headers` over a base; per-origin breaker 4→20 s; 429 jittered backoff; 5xx retry; 10 MB cap; `postStreamingJsonLines`; `ok = status>=200 && <400`; **never throws on an HTTP status** (§1.6) | **confirmed** |
| `verifyInvariants.cjs` pins `RAW_HTTP_ALLOWED` and modelRouter is not on it (§1.6) | **confirmed**, L295–L302, L495 |
| `models:chat` destructures **no** `user`; its chain is `catch { continue; }`; it returns `All models failed. Last error: …` (§1.11 fact 4) | **confirmed**, L296, L322–L335 |
| `path`/`endpoint` would reach the renderer via `gated()`'s `...result` spread (§3.4, round-1 NIT #22) | **confirmed**, L311 |
| `selectModel`'s four passes are roles over `discoveredOllama`, an `offline` pass, the `FALLBACK_CHAIN` loop, `discoveredOllama` again, then `return primaryModel` (§1.11 fact 3) | **confirmed**, L433–L468 |
| `modelRoles.evaluate` returns `{ fit:'none', reasons:['no model supplied'] }` for a model with no `id`, **before** the privacy gate (§1.11 fact 1) | **confirmed**, L146–L148 |
| the privacy gate is `(role.sensitive \|\| requirePrivate) && model.private !== true`, with the leaving-the-machine reason text (§1.4) | **confirmed**, L159–L161 |
| `ROLES` is frozen with nine entries and `narration` alone is `sensitive: true`; `reasoning` is `minParamsB: 14` with **no** `needCaps` — so §3.3's inverse assertion is sound | **confirmed** |
| `selectForRole`'s comparator sorts private before cost; unknown cost `?? 9`; unknown `paramsB` `?? 0` (§1.4) | **confirmed** |
| `ollamaCatalog.paramsB` splits on `:`, matches `/^([\d.]+)b/i` **anchored at the start** → `31b-cloud` → 31, `gemma4` → `null` (§4.4) | **confirmed**, L120–L130 |
| `describeInstalled` emits `type: 'cloud-ollama'\|'local'\|'unknown'`, `credKey: null`, and never folds `unknown` into local (§1.3) | **confirmed**, L271–L277 |
| `paramsB` is exported from `ollamaCatalog` (§4.4's "call the real function") | **confirmed**, L534 |
| `API_RATE_LIMITS` has six rows, no `maxConcurrent`, no `inFlight`, and `ollama: { reqPerMin: 9999 }` (§1.5) | **confirmed**, L75–L82 |
| `_canRun`'s `if (limit) { … }` has **no `else`**, so an unregistered provider passes (§1.5 finding 1) | **confirmed**, L137–L146 |
| `selectOptimalModel`'s `else { return … 'no-rate-limit' }` treats a missing row as a selection, and ends `return { model: 'ollama/phi3', … }` (§1.5 finding 2) | **confirmed**, L359–L364 |
| `selectOptimalModel` destructures `FALLBACK_CHAIN` from a `require` that **succeeds**, so it is `undefined` and `for … of undefined` throws on every call (§1.5 finding 2) | **confirmed**, L335–L351 |
| `admit()` consults RAM/CPU/temp and **never** `aiProvider`; `PRIORITY.CRITICAL` returns first (§1.5 finding 3) | **confirmed**, L385–L395 |
| `submit()` returns a bare id **string** with exactly one caller, the handler that wraps it `{ ok: true, id }` (§1.12 fact 4) | **confirmed**, L207, L477–L480 |
| `orchestrator:record-api-use` is a handler-local implementation (§6.3's "one implementation") | **confirmed**, L508–L516 |
| `capability.can` is `if (!user \|\| typeof user.tier !== 'number') return false`, and an unknown key returns false (§1.11 fact 5, §13.1) | **confirmed**, L27–L32 |
| `capability.deny` returns `{ ok:false, error: '<who> may not do this (needs "<cap>")' }`; `MATRIX` is exported (§13.1) | **confirmed**, L66–L78 |
| `browser.search` is tier 3, `models.use` tier 3, `models.add-key` and `models.ollama-pull` tier 1 — so a tier-1 `models.use-cloud` is a genuine tightening (§13.1) | **confirmed** |
| `PROTECTED_FILES` holds seven paths and **none** is touched by this design (§1.9, §12.5) | **confirmed**, loyaltyGuard.cjs L64–L72 |
| `browser:search` is an inline closure over module-scoped state whose first line is the playwright check; `module.exports = { register, closeBrowser, getBrowserPid }` (§1.12 fact 3) | **confirmed**, L192–L193, L386 |
| `genome.cjs` declares `g.model-router` with `channels: ['models:']` (§1.12 fact 6) | **confirmed**, L75 |
| `preload.cjs`'s `models.chat` forwards the whole options object (§3.4(a)) | **confirmed**, L800 |
| `src/services/ramaClient.js` is the **only** `models.chat` caller; `Chat.jsx:219` and `IDE.jsx:253` call `ramaChat.send`, both with `currentUser` already in scope (L149, L183) (§1.12 fact 2) | **confirmed** |
| `Models.jsx`: `ModelRow` renders **Add key** on `!isAvailable && model.credKey`; tabs filter `m.type === 'cloud'` / `'local'`; rows carry `provider` (used by `PROVIDER_COLORS`) so §7.1's branch can key on it | **confirmed** |
| `Resources.jsx:152–155` is a free-text provider `<input>` submitted verbatim, and `submitTask` acts only `if (res?.ok)` with no `else` (§1.12 fact 5) | **confirmed**, L375–L381 |
| `start.cjs:149–180` `loadEnv()` **copies `.env.example` → `.env`** when absent, parses `KEY=value` into `process.env`, and never overrides an exported variable; called in Stage 0 (L1463) (§1.12 fact 1) | **confirmed** |
| `.env.example` carries `OPENAI_API_KEY=sk-...`, `ANTHROPIC_API_KEY=sk-ant-...`, `GEMINI_API_KEY=AIzaSy...`, `GITHUB_TOKEN=ghp_...`, `OLLAMA_BASE_URL=...`, and **no** `OLLAMA_API_KEY` (§1.10, §7.2) | **confirmed** |
| `.gitignore` line 4 is exactly `.env` (§1.10) | **confirmed** |
| `diagnose()`'s `add = (label, pass, note) => report.push(...)`, `degraded.push({ module, state, gives })`, and only a `defect` carries `fix` (§7.3) | **confirmed**, L320, L374–L379 |
| `http` is already required at `start.cjs:46`, so the probe needs no new import (§7.3) | **confirmed** |
| `verifyInvariants.cjs`: `views()` returns `{ raw, code, nc }` (L111); `viewOf` caches (L165); `walkShipped` walks `electron, src, server, shared` with `.cjs/.mjs/.js/.jsx` and **skips `scripts/`** (L215–L234); banner at L1021 reads `the 17 locked invariants — asserted, not trusted`; header line 4 the same; rows I1–I17; `MUTATIONS` holds **thirteen** cases with exactly the thirteen ids §1.9 lists, each `{ id, expect, why, pick, mutate }` | **confirmed** |
| `scannerSelfCheck()` exists at L244 and already proves `views()` on synthetic strings — so HIGH 2's fix (a) follows an existing convention rather than inventing one | **confirmed** |
| the two measured entropy strings exist where named: `src/services/ghostMode.js:130` and `scripts/verifySelfModel.cjs:307` | **confirmed** |
| **§1.12 fact 7's census** — `electron/ src/ server/ scripts/ shared/` over `.cjs .mjs .js .jsx .json .md` = **194 files** | **confirmed exactly** (`.cjs 103, .jsx 43, .js 36, .mjs 9, .json 3, .md 0`) |
| `customProviders.toRegistryEntries()` exists and `refreshCustomProviders()` mutates `MODEL_REGISTRY` in place with `Object.assign` — the precedent §3.2 cites | **confirmed**, customProviders L214/L232, modelRouter L86–L91 |
| `dataStore` has a `config` domain and `get(domain, key)` / `set(domain, key, value)` (§2.3) | **confirmed**, L44, L96, L102 |
| `npm run verify` is a **27**-segment chain running `verifyOllamaCatalog → verifyOllamaLibrary → verifyWebResearch`, so §12.1's insertion point exists; `verify:ollama-lib`, `audit` and `verify:covenant` are as described (§1.9, §12.1) | **confirmed** |

---

## Unverified / Wrong Assumptions

### Wrong

1. **`_tick`'s increment is "unguarded"** (§1.12 fact 5, §6.4b, §131.7, ledger row). It is
   guarded by truthiness at `resourceOrchestrator.cjs:250`. The `__proto__` hazard is real
   but works differently — the truthy guard *passes* and the write lands on
   `Object.prototype`. → MEDIUM 10.
2. **`PROVIDER_LINKS` maps six services at L16–L21** (§1.8). Eight entries, L15–L23. → NIT 13.
3. **`ramaClient.js:23` / `browserEngine.cjs:193`.** L22 and L192. → NIT 14.
4. **`net.request` with an object `body` is a working call** (§2.5 step 7). It throws inside
   `http.cjs`, and the line is forbidden by §12(g). → HIGH 1.
5. **`diagnose()` can `await`** (§7.3). It is `function diagnose()`, called un-awaited twice.
   → HIGH 4.
6. **A `.md` file exists under `electron/` or `src/` to plant into** (§12.2(c)). Zero, in all
   five trees. → HIGH 2.
7. **"Without those two discriminators it is measurably red on the first commit"** (§12.2(b),
   §131.3, ledger row). True of the pair; **false of the digit test**, which is doing no work
   against either measured string. → MEDIUM 9.
8. **§12(e)'s positive case is runnable from the stated seams** (§10, §12(e)).
   `modelRouter.cjs:10` destructures `getCredential` at load time; no seam reaches it.
   → HIGH 5.
9. **§12(g3)'s `user` assertion is sufficient for the `ramaClient.js` change** (§14, "2
   lines"). The same function discards `unconfigured`, `remedy`, `failures`, `path`,
   `endpoint`, `via` and `credentialSource`. → HIGH 3.

### Unverified here, and correctly flagged by the design

§11 is honest and I am adding nothing to it. Everything about Ollama's live service — the two
auth mechanisms, the Bearer requirement, `x-api-key`'s rejection, *"cloud requests do not
require an Ollama installation"*, `https://ollama.com/settings/keys`, the hosted-search
endpoint path/body/response, thirteen of fourteen inferred `apiModel` values, `GET /api/tags`
on the keyed endpoint, free-tier model accessibility, behaviour at zero credits, the
one-concurrent-request figure, and `/api/chat`'s exact envelope — is taken from the brief and
`OLLAMA_ONLY.md`, and none of it is checkable from here. I confirmed only that the network is
unreachable from this workspace, consistent with §11.1.

Three further things I could not verify, each already named in the document:

- `node_modules` is absent, so **no suite was executed and no claim is made that
  `npm run verify` or `vite build` passes** (§11.8). My findings about
  `verifyInvariants.cjs`'s self-test are read from its source and from a file census, not
  from a run.
- the `browserEngine.searchWeb` extraction is behaviour-preserving **by reading only** — no
  `playwright`, no `ipcMain` here (§11.13). I did confirm the extraction is the only
  implementable option: the handler is a closure and `module.exports` does not carry it.
- `egressBoundary`'s practical value is projected, not measured, because no context store
  exists (§11.10). The structural property is the testable part, which is what HIGH 1 is
  protecting.

### Unverified, and **not** flagged by the design

1. **That `assemble` can produce a search body at all.** §11.3 says the shape is unknown and
   §5.3 says `webSearch` uses the returned body verbatim; nothing records that the search
   body is therefore undefined and that §12(g)'s positive body assertion covers chat only.
   → MEDIUM 7.
2. **That `verifyOllamaCloud.cjs` needs `node_modules`.** §10 says "no Electron", but
   `modelRouter.cjs → credentialVault.cjs:13` requires `electron` at module scope. Under
   plain Node with the package installed, `app` is `undefined` and `getVaultPath()` falls
   back to `~/.rama-agi` — survivable, but it means the suite would touch the directory of
   master's real vault without the stub. → HIGH 5.
3. **That the `.md`/`.json` half of `walkForSecrets` has anything to scan.** Measured: 0
   `.md` and 3 `.json` inside the five trees, two of the three protected. → HIGH 2's closing
   paragraph.
4. **That exactly one CRITICAL waiter can win a release.** An event-based `_awaitSlot` with
   no re-check is specified; two waiters both resolve. → MEDIUM 6.
5. **That `orchestrator:api-limits`' wholesale, ungated return of `API_RATE_LIMITS` is
   intended** after six fields are added to the row. → MEDIUM 8.

---

## On the security properties the step brief weights

Recorded explicitly, because these are the questions the gate exists for, and the design is
right on all of them in intent. Each is **conditional on the findings above**, which is what
CHANGES_REQUESTED means here — not that a property is wrong, but that the mechanism carrying
it does not run.

- **Key only in the vault, never in a tracked file, never logged.** Correct, and correctly
  *re-justified* — the real ground is that `loadEnv()` loads `.env` into `process.env` and
  `start.cjs` spawns every child with `env: { ...process.env }`, which I confirmed. No shape
  hint, no assignment, name in a comment only. `credentialState()`'s four keys and
  `status()`'s fifteen are both enumerated and pinned; `models:cloud-status` is asserted a
  **subset**. `authHeader()` is module-private and built at the call site. The dummy-key
  sweep (exactly one occurrence, in the `Authorization` header; no substring ≥ 6 anywhere
  else) is the right centrepiece and I found nothing that could leak a key. **One caveat:**
  HIGH 1's throw inside `request()` means the sweep's success path never executes as
  specified, so the assertion that *does* the work would be exercising a failure path. Fix
  HIGH 1 and the sweep is sound.
- **Additive (I11); absent key reports ABSENT/UNCONFIGURED; path visible.** The main-process
  half is thorough — the `unconfigured[]`/`failures[]` split, `remedy` riding the thrown
  error, never `All models failed`, `path: 'cloud'|'local'`, the untouched daemon path, and
  §12(j) as the I11 assertion. **HIGH 3 is where it breaks:** the only renderer caller drops
  all of it, so both brief requirements hold in the IPC layer and fail at the UI.
- **`narration` must still refuse a cloud model.** Correct and well defended. I verified the
  gate text, that `private !== true` refuses both `false` and `undefined`, that the `id`
  field is genuinely required (`evaluate` L146–L148 fires first), and that the inverse
  assertion is sound — `reasoning` is `minParamsB: 14` with no `needCaps`, so a 31 B cloud
  row with `caps: ['general','remote',…]` really is fit. The anti-vacuity guard
  (`reasons[0] !== 'no model supplied'`) is the right sixth assertion. Nothing here opens a
  sensitive role to the network. **No finding.**
- **Name divergence, both directions, sized-tag advantage.** `CLOUD_TAGS` frozen,
  authoritative both ways, `null` on unknown, the derivation rule confined to a test, refusal
  **before** any request with zero recorded calls, and `paramsB` taken from the real function
  rather than copied. I verified the regex is start-anchored, so the design's correction to
  the brief's premise ("never worse" rather than "strictly better") is right, and the sized
  rows do reach `declared`. **No finding** beyond MEDIUM 11's clarification that
  `listModels()` must not add rows the table does not attest.
- **`API_RATE_LIMITS` corrected; a missing provider refuses.** `maxConcurrent: 1` with the
  buffer deliberately not applied, `tokPerMin: null` meaning unchecked rather than zero,
  separate `ollama-search` row, refusal at `submit()` (thrown, to preserve the bare-string
  return contract) with `_canRun` as defence in depth, `hasOwnProperty` everywhere, and the
  every-shipped-provider-has-a-row assertion that makes refusing safe. The ceiling correctly
  reasserted through `admit()`, the function the transport actually calls, at the enforced
  16/min rather than the tabled 20. **MEDIUM 6** (two CRITICAL waiters), **MEDIUM 8**
  (ungated row exposure) and **MEDIUM 10** (the `_tick` description) attach here.
- **Web search cannot carry master's private context off the machine; enforced on the
  payload at the cloud boundary.** The round-2 fix is right and the reasoning is right: the
  gate runs **once, above backend selection**, a refusal is **terminal** for every backend,
  the module is `egressBoundary` because "egress" means off this machine, there is **no
  bare-string allowance** for a query, and both stubs are asserted at zero calls. The
  `browser:search` legacy channel is named as a limit rather than claimed as coverage, which
  is the honest framing. **MEDIUM 7** is the gap: the accepted search body is undefined, so
  the one constructor's output is unreviewed even though its input is gated.
- **Protected files; a capability entry raised, not resolved.** Clean. `models.use-cloud`
  tier 1 is specified with the optional-tightening gate so the feature degrades rather than
  dies, `status().cloudCapability` says which key is in force, `verifyLoyaltyTripwire
  --approve` is never run, and all seven protected files are untouched (verified). The
  `I-SECRETS`-not-I12 decision is right and the `I18` promotion is correctly raised rather
  than taken. **No finding.** (One pre-existing caveat worth a sentence somewhere: `user`
  arrives from the renderer, so `capability.can(user, …)` is an authorisation check against a
  renderer-asserted identity. That is the established house pattern — `models:roles`,
  `models:refresh-catalog` and `vault.set` all do it — and this design strictly improves on
  `models:chat`'s current state of no gate at all, so it is not a regression. It should just
  not be described as a boundary against a compromised renderer.)
- **Spec not edited; Section 131 and ledger row 151 as ready-to-paste blocks.**
  `RAMA_AGI_MASTER_SPEC.md` is untouched, both blocks live in §15 destined for
  `docs/research/OLLAMA_CLOUD.md`, and the numbering caution (148/149 unassigned, 128/129
  claimed in prose) is carried in both the preamble and the row. **No finding** — except that
  §131.7 and the ledger row currently carry the MEDIUM 9 and MEDIUM 10 misstatements into a
  tracked file, which is why both are MEDIUM rather than NIT.

---

## What to change, in the order I would change it

1. **HIGH 1** — `net.post` / `net.get`; restate §12(g)'s structural clause; add the positive
   success assertion. One line of design, and it is the line that sends the request.
2. **HIGH 3** — forward the response fields in `ramaClient.js`; name the `Chat.jsx` surface
   that renders `remedy`; widen §12(g3). This is the one that decides whether master can see
   any of this.
3. **HIGH 2** — move the view-choice assertion into `scannerSelfCheck()`; drop
   `I-SECRETS-planted-md`; note that `.md` scans zero files in the five trees.
4. **HIGH 4** — drop the probe from `diagnose()` (preferred), or make it async and list both
   call sites plus `probeLocal`'s contract.
5. **HIGH 5** — specify the require-cache vault stub; record that the suite needs
   `node_modules`; assert no vault directory is touched.
6. **MEDIUM 6, 7, 8, 9, 10, 11** — each is a paragraph or a snippet, and 9 and 10 are
   corrections to text already written into the ready-to-paste blocks.
7. **NIT 12–15** — line numbers, the `http` binding name, and the `.env.example` note.

Nothing here requires re-deciding anything. Fix the eleven and this is ready to build.
