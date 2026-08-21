'use strict';

/**
 * selfRepair.cjs — the installed app repairing a missing dependency itself.
 *
 * WHY THIS EXISTS, AND WHAT I GOT WRONG BEFORE IT. Section 49 claimed a packaged
 * app "cannot npm-install a module into its own read-only archive, and claiming
 * otherwise would be a lie". That sentence is true and was used to justify a
 * conclusion that is false. It answers "can the asar be patched in place?" — no.
 * It does not answer "can the app obtain a missing module?" — which it can, because
 * the asar is not the only place code may live:
 *
 *   - `userData` is writable, on every platform, in every install
 *   - Node's module resolution can be pointed at a writable directory
 *   - `asarUnpack` already proves code outside the archive loads fine
 *
 * So "contain, explain, record, ask master to reinstall" was not the limit of what
 * is achievable. It was the limit of what had been built. Master was right to
 * reject it.
 *
 * WHY THE LOCKFILE IS THE AUTHORITY. Downloading and then executing code at
 * runtime is the most security-sensitive thing in this codebase, so it is bounded
 * by something already trustworthy rather than by an error message:
 *
 *   - `package-lock.json` ships inside the app and names 745 packages with EXACT
 *     versions, resolved tarball URLs, and sha512 integrity hashes
 *   - only a package present in that lockfile can be fetched — a crafted
 *     "Cannot find module 'x'" cannot induce an arbitrary download
 *   - only at the version the lockfile pins (invariant I12)
 *   - and only if the sha512 matches, or the bytes are discarded
 *
 * Repair therefore means exactly one thing: restore what this build already
 * declared it was made of. It cannot install something new, upgrade anything, or
 * be steered. That is a much narrower power than `npm install`, deliberately.
 *
 * DEPENDENCY-FREE BY NECESSITY. Core modules only — `https`, `zlib`, `crypto`,
 * `fs`, `path`. A repair mechanism that needed a third-party package could not
 * repair a missing third-party package, which is the case it exists for. The tar
 * reader below is written out for the same reason.
 */

const fs     = require('fs');
const path   = require('path');
const zlib   = require('zlib');
const https  = require('https');
const crypto = require('crypto');
const Module = require('module');

const MAX_TARBALL_BYTES = 40 * 1024 * 1024;   // no lockfile package is near this
const DOWNLOAD_TIMEOUT  = 30_000;

const log = [];   // what repair did, for the health report

function note(entry) {
  log.unshift({ ts: Date.now(), ...entry });
  if (log.length > 100) log.pop();
}

// ─── Where repaired modules live ──────────────────────────────────────────────
function appRoot() {
  return path.join(__dirname, '..', '..');
}

function repairDir() {
  // An override exists so the behavioural test can point repair at a temp
  // directory instead of writing into master's profile. It is not an attack
  // surface worth worrying about: anything able to set environment variables on
  // this process can already set NODE_PATH, which controls module resolution far
  // more directly than the destination of a checksum-verified download.
  if (process.env.RAMA_REPAIR_DIR) {
    return path.join(process.env.RAMA_REPAIR_DIR, 'node_modules');
  }
  let base = null;
  try { base = require('electron').app?.getPath('userData') ?? null; }
  catch { /* app unavailable — fall back below */ }
  if (!base) base = path.join(require('os').homedir(), '.rama-agi');
  return path.join(base, 'repair', 'node_modules');
}

/**
 * Make the writable repair directory resolvable by `require`.
 *
 * DO NOT CALL `Module._initPaths()` HERE. That is what this function used to do,
 * and it broke every packaged build.
 *
 * `_initPaths()` does not *extend* the search paths, it **recomputes them from
 * scratch**. Electron patches Node's module system so that paths inside `app.asar`
 * resolve; recomputing discards those patched entries. The result in a packaged app
 * was that every `require()` after the first `safeRequire()` failed with
 * MODULE_NOT_FOUND, so `safeRequire` replaced *every* engine with a stub — and
 * because `sessionManager` and `dataStore` are the last two loaded, the visible
 * symptom was "No handler registered for 'session:unlock'" with the packages all
 * verifiably present in the asar. In development there is no asar, so `_initPaths()`
 * recomputed paths that still worked and nothing looked wrong. See Section 62.
 *
 * Appending to `Module.globalPaths` achieves the same thing without destroying
 * anything: it is consulted *after* the normal `node_modules` walk, so a module
 * inside the asar keeps resolving from the asar and only falls through to the repair
 * directory when it is genuinely absent. Repair still never shadows a working
 * module, which was the original point.
 */
/**
 * Make the repair directory reachable, as a **last resort only**.
 *
 * `Module._resolveFilename` is wrapped so that the repair directory is consulted
 * *after normal resolution has already thrown*. Two consequences, both wanted:
 *
 *   - Repair can never shadow a working module. Not by convention or ordering, but
 *     because this code does not execute unless the normal walk — including
 *     everything Electron makes resolvable inside `app.asar` — has already failed.
 *   - Nothing existing is removed, recomputed or reordered, which is exactly where
 *     `Module._initPaths()` went wrong (Section 62).
 *
 * Appending to the array from `_resolveLookupPaths` was tried first and did not
 * work — the behavioural test caught it. Failing over on the error is both simpler
 * and a stronger guarantee.
 *
 * Relative, absolute and `node:` specifiers are rethrown untouched.
 */
const _repairDirs = new Set();
let _resolveHooked = false;

function installLookupHook(dir) {
  _repairDirs.add(dir);
  if (_resolveHooked) return;
  _resolveHooked = true;

  const original = Module._resolveFilename;
  Module._resolveFilename = function resolveFilenameWithRepair(request, parent, isMain, options) {
    try {
      return original.call(this, request, parent, isMain, options);
    } catch (err) {
      if (typeof request !== 'string') throw err;
      if (request.startsWith('.') || request.startsWith('node:') || path.isAbsolute(request)) throw err;

      const dirs = [..._repairDirs];
      // `options.paths` is the documented mechanism — the same one
      // `require.resolve(x, { paths })` uses — so this is a supported lookup rather
      // than a guess at Node's internals.
      try { return original.call(this, request, parent, isMain, { ...(options || {}), paths: dirs }); }
      catch { /* not in the repair dirs either */ }

      for (const repair of dirs) {
        // Direct path, which covers a package whose entry point is unusual.
        try { return original.call(this, path.join(repair, request), parent, isMain, options); }
        catch { /* fall through */ }
      }
      throw err;   // genuinely absent — report the original failure, not ours
    }
  };
}

function registerRepairPath() {
  const dir = repairDir();
  try { fs.mkdirSync(dir, { recursive: true }); }
  catch (e) { return { ok: false, error: `repair directory unavailable: ${e.message}` }; }

  // Appending to `Module.globalPaths` looks like the obvious answer and does
  // nothing: Node resolves bare specifiers through an internal `modulePaths`, and
  // `globalPaths` is only the copy `_initPaths()` publishes. The behavioural test
  // caught that. So the lookup itself is extended, once, additively.
  try { installLookupHook(dir); }
  catch (e) { return { ok: false, error: `could not extend module paths: ${e.message}` }; }

  // Kept in step for any child process we spawn, which reads NODE_PATH at its own
  // startup. This process's resolution comes from globalPaths above, never from
  // re-reading this value.
  try {
    const current = process.env.NODE_PATH ? process.env.NODE_PATH.split(path.delimiter) : [];
    if (!current.includes(dir)) process.env.NODE_PATH = [...current, dir].join(path.delimiter);
  } catch { /* env is advisory here */ }

  return { ok: true, dir };
}

// ─── The lockfile is the allowlist ────────────────────────────────────────────
let _lock = null;

function lockfile() {
  if (_lock !== null) return _lock;
  for (const candidate of [
    path.join(appRoot(), 'package-lock.json'),
    path.join(__dirname, '..', '..', 'package-lock.json'),
  ]) {
    try {
      _lock = JSON.parse(fs.readFileSync(candidate, 'utf8'));
      return _lock;
    } catch { /* try the next */ }
  }
  _lock = false;
  return _lock;
}

/**
 * The lockfile entry for a package name, or null if it is not one of ours.
 *
 * Prefers the hoisted top-level entry, which is what a failed resolution from
 * inside the asar was looking for.
 */
function lockEntry(name) {
  const lock = lockfile();
  if (!lock || !lock.packages) return null;

  const direct = lock.packages[`node_modules/${name}`];
  if (direct?.resolved && direct?.integrity) return { key: `node_modules/${name}`, ...direct };

  // A nested copy is acceptable evidence of the same package+version.
  for (const [key, entry] of Object.entries(lock.packages)) {
    if (!key.endsWith(`/node_modules/${name}`)) continue;
    if (entry?.resolved && entry?.integrity) return { key, ...entry };
  }
  return null;
}

// ─── Download, verified ───────────────────────────────────────────────────────
function download(url, redirectsLeft = 4) {
  return new Promise((resolve) => {
    let req;
    try {
      req = https.get(url, { headers: { 'User-Agent': 'Rama-AGI-SelfRepair' } }, (res) => {
        if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location && redirectsLeft > 0) {
          res.resume();
          resolve(download(res.headers.location, redirectsLeft - 1));
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          resolve({ ok: false, error: `HTTP ${res.statusCode} for ${url}` });
          return;
        }
        const chunks = [];
        let total = 0;
        res.on('data', (c) => {
          total += c.length;
          if (total > MAX_TARBALL_BYTES) {
            req.destroy();
            resolve({ ok: false, error: 'tarball exceeded the size limit' });
            return;
          }
          chunks.push(c);
        });
        res.on('end', () => resolve({ ok: true, body: Buffer.concat(chunks) }));
        res.on('error', (e) => resolve({ ok: false, error: e.message }));
      });
    } catch (e) {
      resolve({ ok: false, error: e.message });
      return;
    }
    req.on('error', (e) => resolve({ ok: false, error: e.message }));
    req.setTimeout(DOWNLOAD_TIMEOUT, () => {
      req.destroy();
      resolve({ ok: false, error: `timed out after ${DOWNLOAD_TIMEOUT / 1000}s` });
    });
  });
}

/**
 * npm's `integrity` is `<alg>-<base64>`. Mismatched bytes are discarded, never
 * written — this is the check that makes fetching code at runtime defensible.
 */
function integrityMatches(buffer, integrity) {
  try {
    const sep = String(integrity).indexOf('-');
    if (sep < 1) return false;
    const alg      = String(integrity).slice(0, sep);
    const expected = String(integrity).slice(sep + 1);
    if (!/^sha(256|384|512)$/.test(alg)) return false;   // no weak digests accepted
    const actual = crypto.createHash(alg).update(buffer).digest('base64');
    // Lengths differ on a mismatch, and timingSafeEqual throws rather than
    // returning false in that case — hence the surrounding try.
    return crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
  } catch { return false; }
}

// ─── Minimal tar reader (core only, on purpose) ───────────────────────────────
/**
 * npm tarballs are ustar with every path under `package/`. Only what is needed to
 * unpack one is implemented: regular files, directories, the ustar `prefix` field
 * and GNU long names.
 *
 * Paths are checked against traversal before anything is written — a tar entry is
 * attacker-controlled input in the general case, and `../` in a member name is the
 * classic way out of a target directory.
 */
function extractTar(buffer, destDir) {
  const BLOCK = 512;
  let offset = 0;
  let pendingLongName = null;
  let written = 0;

  const str = (buf, start, len) => {
    const slice = buf.slice(start, start + len);
    const end = slice.indexOf(0);
    return slice.slice(0, end === -1 ? slice.length : end).toString('utf8');
  };

  while (offset + BLOCK <= buffer.length) {
    const header = buffer.slice(offset, offset + BLOCK);
    if (header.every(b => b === 0)) break;   // end-of-archive

    let name = str(header, 0, 100);
    const prefix = str(header, 345, 155);
    if (prefix) name = `${prefix}/${name}`;
    if (pendingLongName) { name = pendingLongName; pendingLongName = null; }

    const sizeField = str(header, 124, 12).trim();
    const size = parseInt(sizeField, 8) || 0;
    const type = String.fromCharCode(header[156]);

    offset += BLOCK;
    const data = buffer.slice(offset, offset + size);
    offset += Math.ceil(size / BLOCK) * BLOCK;

    if (type === 'L') { pendingLongName = data.toString('utf8').replace(/\0+$/, ''); continue; }
    if (type === '5') continue;                       // directory — created on demand
    if (type !== '0' && type !== '\0' && type !== '') continue;   // links, etc: skipped

    // Strip the leading `package/` npm wraps everything in.
    const rel = name.replace(/^[^/]+\//, '');
    if (!rel) continue;

    const target = path.join(destDir, rel);
    const resolved = path.resolve(target);
    if (!resolved.startsWith(path.resolve(destDir) + path.sep)) {
      return { ok: false, error: `refused a tar entry escaping the target directory: ${name}` };
    }

    try {
      fs.mkdirSync(path.dirname(resolved), { recursive: true });
      fs.writeFileSync(resolved, data);
      written++;
    } catch (e) {
      return { ok: false, error: `writing ${rel} failed: ${e.message}` };
    }
  }

  return written > 0
    ? { ok: true, files: written }
    : { ok: false, error: 'archive contained no files' };
}

// ─── Repair ───────────────────────────────────────────────────────────────────
function alreadyResolvable(name) {
  try { require.resolve(name); return true; }
  catch { return false; }
}

function installedInRepairDir(name) {
  try { return fs.existsSync(path.join(repairDir(), name, 'package.json')); }
  catch { return false; }
}

/**
 * Obtain one package from the lockfile into the repair directory.
 * @returns {Promise<{ok:boolean, name:string, version?:string, error?:string, already?:boolean}>}
 */
async function fetchOne(name) {
  if (installedInRepairDir(name)) return { ok: true, name, already: true };

  const entry = lockEntry(name);
  if (!entry) {
    // Not in the lockfile means it is not part of this build. Refusing is the
    // whole point: repair restores what was declared, it does not acquire.
    return { ok: false, name, error: 'not present in package-lock.json — refusing to fetch it' };
  }

  const got = await download(entry.resolved);
  if (!got.ok) return { ok: false, name, error: got.error };

  if (!integrityMatches(got.body, entry.integrity)) {
    return { ok: false, name, error: 'integrity check failed — bytes discarded' };
  }

  let tar;
  try { tar = zlib.gunzipSync(got.body); }
  catch (e) { return { ok: false, name, error: `gunzip failed: ${e.message}` }; }

  const dest = path.join(repairDir(), ...name.split('/'));
  try { fs.mkdirSync(dest, { recursive: true }); }
  catch (e) { return { ok: false, name, error: `mkdir failed: ${e.message}` }; }

  const out = extractTar(tar, dest);
  if (!out.ok) return { ok: false, name, error: out.error };

  return { ok: true, name, version: entry.version, files: out.files };
}

/**
 * Repair a missing module and everything it needs, following the lockfile's own
 * dependency list. Bounded: a package whose deps are already resolvable adds
 * nothing to the queue, and the total is capped so a pathological graph cannot
 * spin here forever.
 *
 * @param {string} name
 * @returns {Promise<{ok:boolean, repaired:string[], failed:Array, error?:string}>}
 */
async function repairModule(name, { maxPackages = 40 } = {}) {
  const reg = registerRepairPath();
  if (!reg.ok) return { ok: false, repaired: [], failed: [], error: reg.error };

  if (!lockfile()) {
    return { ok: false, repaired: [], failed: [], error: 'package-lock.json is not available in this build' };
  }

  const queue    = [name];
  const seen     = new Set();
  const repaired = [];
  const failed   = [];

  while (queue.length && repaired.length < maxPackages) {
    const current = queue.shift();
    if (seen.has(current)) continue;
    seen.add(current);

    if (alreadyResolvable(current)) continue;

    const res = await fetchOne(current);
    if (!res.ok) { failed.push(res); continue; }
    if (!res.already) repaired.push(`${res.name}@${res.version ?? '?'}`);

    // Its own dependencies may be missing for the same reason it was.
    const entry = lockEntry(current);
    for (const dep of Object.keys(entry?.dependencies ?? {})) {
      if (!seen.has(dep) && !alreadyResolvable(dep)) queue.push(dep);
    }
  }

  const ok = failed.length === 0 && (repaired.length > 0 || alreadyResolvable(name));
  note({ action: 'repair', module: name, ok, repaired, failed: failed.map(f => `${f.name}: ${f.error}`) });
  return { ok, repaired, failed };
}

/** What repair has done this session — surfaced through health:startup. */
function history() { return log.slice(); }

module.exports = {
  registerRepairPath, repairModule, repairDir, history,
  // exported for tests
  lockEntry, integrityMatches, extractTar, alreadyResolvable,
};
