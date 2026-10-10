#!/usr/bin/env node
/**
 * buildUserGuide.mjs — generates docs/UserGuide.pdf.
 *
 * WHY IT IS GENERATED AND NOT WRITTEN BY HAND. A hand-written guide is wrong the first time a page is
 * renamed, a shortcut moves or a capability tier changes, and nothing tells anyone. Everything factual
 * in this document is therefore READ OUT OF THE SOURCE that implements it:
 *
 *   pages, descriptions, voice phrases, tiers   src/config/registry.js
 *   access tiers and what each may do           shared/capabilities.json
 *   the financial/chart vocabulary              src/pages/StockMind/glossary.js
 *   keyboard shortcuts                          src/components/CommandPalette.jsx, PriceChart.jsx
 *   the voice ladder                            electron/ipc/voiceEngine.cjs
 *
 * `registry.js` imports React and an aliased module, so it cannot be imported from a plain script;
 * its page table is parsed as text instead, and THE PARSE ASSERTS ITS OWN COUNT — a regex that
 * silently matched nothing would otherwise produce a guide with no features in it.
 *
 * The PDF is printed by Chromium through Playwright's installed `msedge` channel, which is the same
 * mechanism `renderCheckTypeScale.mjs` already relies on, so no browser is downloaded.
 *
 * Run: node scripts/buildUserGuide.mjs   (or npm run guide)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'docs');
const OUT_PDF = path.join(OUT_DIR, 'UserGuide.pdf');

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function fail(msg) {
  console.error(`\nbuildUserGuide: ${msg}\n`);
  process.exit(1);
}

// ── 1. The page table, parsed with its own count assertion ──────────────────
function loadPages() {
  const src = read('src/config/registry.js');
  const expected = (src.match(/^\s*route: '/gm) || []).length;
  if (expected === 0) fail('found no pages in src/config/registry.js — the parse is broken, not the registry');

  const pages = [];
  // Each entry runs from `route:` to the closing `},` of its object literal.
  const blocks = src.split(/\n\s*\{\s*\n?\s*(?=route: ')/).slice(1);
  for (const block of blocks) {
    const body = block.split(/\n\s*\},/)[0];
    const pick = (key) => {
      const m = new RegExp(`${key}:\\s*'([^']*)'`).exec(body);
      return m ? m[1] : null;
    };
    const pickList = (key) => {
      const m = new RegExp(`${key}:\\s*\\[([^\\]]*)\\]`).exec(body);
      if (!m) return [];
      return (m[1].match(/'([^']*)'/g) || []).map((s) => s.slice(1, -1));
    };
    const route = pick('route');
    if (!route) continue;
    pages.push({
      route,
      id: pick('id'),
      label: pick('label'),
      desc: pick('desc'),
      minTier: (/minTier:\s*TIERS\.([A-Z_]+)/.exec(body) || [, null])[1],
      voice: pickList('voice'),
      capabilities: pickList('capabilities'),
    });
  }

  // THE ASSERTION THAT MAKES THE PARSE TRUSTWORTHY.
  if (pages.length !== expected) {
    fail(`parsed ${pages.length} pages but the registry declares ${expected}. `
      + 'The guide is not written from a partial feature list — fix the parse.');
  }
  for (const p of pages) {
    if (!p.label || !p.desc) fail(`page ${p.route} is missing a label or desc in the registry`);
  }
  return pages;
}

// ── 2. Tiers and capabilities ───────────────────────────────────────────────
function loadCapabilities() {
  const spec = JSON.parse(read('shared/capabilities.json'));
  const tiers = Object.entries(spec.tiers).sort((a, b) => a[1] - b[1]);
  const caps = Object.entries(spec.capabilities).sort((a, b) => a[0].localeCompare(b[0]));
  if (tiers.length === 0 || caps.length === 0) fail('shared/capabilities.json parsed empty');
  return { tiers, caps, labels: spec.tierLabels, version: spec.version };
}

// ── 3. The glossary, imported directly (it has no imports of its own) ───────
async function loadGlossary() {
  const mod = await import(
    `file://${path.join(ROOT, 'src/pages/StockMind/glossary.js').replace(/\\/g, '/')}`);
  const terms = mod.TERMS || {};
  const groups = mod.GROUPS || [];
  const count = Object.keys(terms).length;
  if (count < 50) fail(`the glossary parsed only ${count} terms, which is too few to be the real one`);
  return { terms, groups, count };
}

// ── 4. Shortcuts, read from the components that implement them ──────────────
function loadShortcuts() {
  const palette = read('src/components/CommandPalette.jsx');
  const chart = read('src/pages/StockMind/PriceChart.jsx');

  const rows = [];
  // CommandPalette's two documented chords.
  if (/key === 'm'/.test(palette)) rows.push(['Ctrl/Cmd + Shift + M', 'Mute or unmute the microphone', 'Anywhere']);
  if (/key === 's'/.test(palette)) rows.push(['Ctrl/Cmd + Shift + S', 'Mute or unmute Rāma\'s voice', 'Anywhere']);

  // The chart types, by the table that actually defines them.
  const types = [...chart.matchAll(/\{\s*id: '([a-z]+)',\s*label: '([^']+)',\s*key: '([0-9])'/g)]
    .map((m) => ({ id: m[1], label: m[2], key: m[3] }));
  if (types.length === 0) fail('found no chart types in PriceChart.jsx — the parse is broken');
  rows.push([types.map((t) => t.key).join(' '), `Chart type: ${types.map((t) => t.label).join(', ')}`, 'StockMind chart']);

  for (const [re, label] of [
    [/if \(k === 'f'\)/, 'Fullscreen the chart'],
    [/if \(k === 'l'\)/, 'Toggle logarithmic price scale'],
    [/if \(k === 'r'\)/, 'Reset the zoom'],
    [/if \(k === 'v'\)/, 'Show or hide the volume pane'],
  ]) {
    if (re.test(chart)) {
      const key = /'([a-z])'\)/.exec(re.source.match(/'([a-z])'/)[0]) || [, '?'];
      rows.push([key[1].toUpperCase(), label, 'StockMind chart']);
    }
  }
  rows.push(['[  and  ]', 'Narrow or widen the candles', 'StockMind chart']);
  rows.push(['Escape', 'Cancel the active drawing tool', 'StockMind chart']);
  return { rows, types };
}

// ── 5. The voice ladder, read from the engine that implements it ────────────
function loadVoice() {
  const src = read('electron/ipc/voiceEngine.cjs');
  const candidates = (/WHISPER_CANDIDATES = \[([^\]]*)\]/.exec(src) || [, ''])[1]
    .match(/'([^']*)'/g)?.map((s) => s.slice(1, -1)) || [];
  const cloudKey = /getCredential\('([A-Z_]+)'\)/.exec(src)?.[1] || null;
  const endpoint = /https:\/\/api\.openai\.com[^\s'"]*/.exec(src)?.[0] || null;
  if (candidates.length === 0) fail('could not read the Whisper candidate list from voiceEngine.cjs');
  return { candidates, cloudKey, endpoint };
}

// ── 6. Compose ──────────────────────────────────────────────────────────────
function tierName(labels, n) { return labels?.[String(n)] || `tier ${n}`; }

function buildHtml({ pages, caps, glossary, shortcuts, voice, generatedAt }) {
  const pageRows = pages.map((p) => `
    <tr>
      <td class="mono">${esc(p.route)}</td>
      <td><strong>${esc(p.label)}</strong></td>
      <td>${esc(p.desc)}</td>
      <td class="mono small">${esc(p.minTier || '—')}</td>
    </tr>`).join('');

  const pageDetail = pages.map((p) => `
    <section class="feature">
      <h3>${esc(p.label)} <span class="mono route">${esc(p.route)}</span></h3>
      <p>${esc(p.desc)}</p>
      ${p.capabilities.length ? `<p class="meta"><span class="k">What it can do:</span> ${p.capabilities.map(esc).join(' · ')}</p>` : ''}
      ${p.voice.length ? `<p class="meta"><span class="k">Say:</span> ${p.voice.map((v) => `“${esc(v)}”`).join(' · ')}</p>` : ''}
      <p class="meta"><span class="k">Lowest tier that may open it:</span> ${esc(p.minTier || 'unrestricted')}</p>
    </section>`).join('');

  const tierRows = caps.tiers.map(([name, n]) => `
    <tr><td class="mono">${n}</td><td><strong>${esc(name)}</strong></td><td>${esc(tierName(caps.labels, n))}</td>
    <td class="mono small">${caps.caps.filter(([, req]) => n <= req).length} of ${caps.caps.length}</td></tr>`).join('');

  const shortcutRows = shortcuts.rows.map(([k, what, where]) => `
    <tr><td class="mono key">${esc(k)}</td><td>${esc(what)}</td><td class="small">${esc(where)}</td></tr>`).join('');

  const groupOrder = glossary.groups.length
    ? glossary.groups.map((g) => g.id || g)
    : [...new Set(Object.values(glossary.terms).map((t) => t.group))];

  const glossarySections = groupOrder.map((gid) => {
    const entries = Object.entries(glossary.terms).filter(([, t]) => t.group === gid);
    if (entries.length === 0) return '';
    const label = (glossary.groups.find((g) => (g.id || g) === gid) || {}).label || gid;
    return `<h3>${esc(label)}</h3><dl>${entries.map(([, t]) =>
      `<dt>${esc(t.term)}</dt><dd>${esc(t.short)}</dd>`).join('')}</dl>`;
  }).join('');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Rāma AGI — User Guide</title>
<style>
  @page { size: A4; margin: 18mm 16mm 20mm 16mm; }
  * { box-sizing: border-box; }
  body { font: 10.5pt/1.5 "Segoe UI", system-ui, sans-serif; color: #14171c; margin: 0; }
  h1 { font-size: 30pt; margin: 0 0 4pt; letter-spacing: -0.5pt; }
  h2 { font-size: 16pt; margin: 22pt 0 6pt; padding-bottom: 4pt;
       border-bottom: 1.5pt solid #0b7285; color: #0b7285; page-break-after: avoid; }
  h3 { font-size: 11.5pt; margin: 14pt 0 3pt; page-break-after: avoid; }
  p { margin: 0 0 6pt; }
  table { width: 100%; border-collapse: collapse; margin: 6pt 0 10pt; font-size: 9pt; }
  th, td { text-align: left; padding: 4pt 6pt; border-bottom: 0.5pt solid #d7dbe0; vertical-align: top; }
  th { background: #eef4f6; font-weight: 600; border-bottom: 1pt solid #0b7285; }
  .mono { font-family: Consolas, "Courier New", monospace; }
  .small { font-size: 8.5pt; color: #5b6572; }
  .key { white-space: nowrap; font-weight: 600; }
  .route { font-size: 9pt; color: #5b6572; font-weight: 400; }
  .meta { font-size: 9pt; color: #3d4652; margin: 1pt 0; }
  .meta .k { color: #0b7285; font-weight: 600; }
  .feature { page-break-inside: avoid; margin-bottom: 8pt; }
  .cover { height: 232mm; display: flex; flex-direction: column; justify-content: center; }
  .sub { font-size: 13pt; color: #5b6572; margin-top: 2pt; }
  .stamp { margin-top: 20pt; font-size: 9pt; color: #5b6572; }
  .note { background: #fff8e1; border-left: 3pt solid #c79100; padding: 7pt 10pt; margin: 8pt 0;
          font-size: 9.5pt; page-break-inside: avoid; }
  .warn { background: #fdecea; border-left: 3pt solid #c0392b; padding: 7pt 10pt; margin: 8pt 0;
          font-size: 9.5pt; page-break-inside: avoid; }
  dl { margin: 2pt 0 8pt; font-size: 9pt; }
  dt { font-weight: 600; margin-top: 4pt; }
  dd { margin: 0 0 0 14pt; color: #3d4652; }
  ol, ul { margin: 0 0 6pt 16pt; padding: 0; }
  li { margin-bottom: 3pt; }
  .break { page-break-before: always; }
</style></head><body>

<div class="cover">
  <h1>Rāma AGI</h1>
  <div class="sub">User Guide — every feature, and how to use it</div>
  <div class="stamp">
    Prepared for Krishna Prasad<br>
    Generated ${esc(generatedAt)}<br><br>
    This document is generated from the source that implements each feature:
    the page registry, the capability matrix, the glossary and the components
    themselves. It describes ${pages.length} pages, ${caps.caps.length} capabilities
    and ${glossary.count} glossary terms.
  </div>
</div>

<div class="break"></div>
<h2>1. What Rāma is</h2>
<p>Rāma is a desktop application: an Electron shell around a React interface, an Express service and a
Python analysis engine. It runs on your machine. Your data, your credentials and your conversations
live in encrypted files in your own user directory.</p>
<p>It has ${pages.length} pages, reachable from the left rail or by keyboard. Each one is listed in
section 3 with what it does, what it can be asked to do, and the lowest access tier allowed to open it.</p>

<h2>2. Starting up, and the two passwords</h2>
<ol>
  <li><strong>Launch.</strong> <span class="mono">npm run dev</span> during development, or the
      installed application. <span class="mono">node start.cjs --diagnose</span> reports anything the
      environment is missing, and <span class="mono">--repair</span> lets Rāma fix what it can.</li>
  <li><strong>The passcode gate.</strong> Your passcode opens the encrypted store that holds
      everything Rāma remembers. Enter it wrong and nothing opens — there is no partial unlock.</li>
  <li><strong>The credential vault.</strong> Separate, and this surprises people.</li>
</ol>
<div class="note"><strong>Why you are asked for a password twice.</strong>
There are two encrypted stores, with two independent keys.
The <strong>passcode</strong> at startup opens Rāma's own memory.
The <strong>vault master password</strong>, entered on the Models page, opens the credential vault that
holds your provider API keys. Neither unlocks the other, by design: one stolen secret should not open
both. You may choose the same text for both if you prefer — that is your decision, not a requirement.
</div>

<h2>3. The pages</h2>
<table>
  <thead><tr><th>Route</th><th>Page</th><th>What it is for</th><th>Min tier</th></tr></thead>
  <tbody>${pageRows}</tbody>
</table>

<div class="break"></div>
<h2>4. Each page in detail</h2>
${pageDetail}

<div class="break"></div>
<h2>5. Access tiers</h2>
<p>A lower number means more privilege. Every capability names the lowest-privileged tier still
permitted to use it, and an unknown capability is denied rather than allowed. Matrix version
${esc(String(caps.version))}.</p>
<table>
  <thead><tr><th>Tier</th><th>Name</th><th>Label</th><th>Capabilities held</th></tr></thead>
  <tbody>${tierRows}</tbody>
</table>

<h2>6. Keyboard</h2>
<table>
  <thead><tr><th>Keys</th><th>Action</th><th>Where</th></tr></thead>
  <tbody>${shortcutRows}</tbody>
</table>
<p class="small">Click the chart before using its keys — they are scoped to it rather than registered
on the whole document, so they cannot interfere with typing a symbol.</p>

<h2>7. Talking to Rāma</h2>
<p>Rāma can <strong>speak</strong> out of the box: speech synthesis uses the voices your operating
system already has, needs no model and no network. That is why the mute chord exists.</p>
<p><strong>Listening is different, and needs something installed.</strong> The Electron shell cannot use
the browser's built-in speech recognition — Chromium here is built without the keys Chrome ships with,
so every attempt fails. Rāma therefore uses a ladder, local before cloud:</p>
<table>
  <thead><tr><th>Level</th><th>What it is</th><th>What it needs</th></tr></thead>
  <tbody>
    <tr><td class="mono">0</td><td>Text only</td><td>Nothing</td></tr>
    <tr><td class="mono">1</td><td>Capture only — it can record, not transcribe</td><td>Microphone permission</td></tr>
    <tr><td class="mono">2</td><td>Local transcription, private and free</td>
        <td>A Whisper binary on your PATH: ${voice.candidates.map((c) => `<span class="mono">${esc(c)}</span>`).join(', ')}.
        An explicit path in <span class="mono">RAMA_WHISPER_BIN</span> also works.</td></tr>
    <tr><td class="mono">3</td><td>Cloud transcription</td>
        <td>${voice.cloudKey ? `A <span class="mono">${esc(voice.cloudKey)}</span> entry in the credential vault` : 'A provider key in the vault'}</td></tr>
  </tbody>
</table>
<div class="warn"><strong>If voice input does nothing, this is why.</strong>
The chip beside the microphone shows your level — <span class="mono">L0</span> to
<span class="mono">L4</span> — and clicking it re-checks. At level 0 or 1 nothing can be transcribed,
and Rāma will now say so where you released the talk button instead of leaving
“Transcribing…” on screen. Install a Whisper binary for level 2, which is the private and free option,
or add a provider key to the vault for level 3.
</div>
<p><strong>Hold to talk</strong>, release to transcribe. A clip too short to be speech is discarded
rather than sent. While Rāma is speaking there is a cool-down so it does not transcribe its own voice
back as a command.</p>
<div class="note"><strong>How Rāma replies.</strong> Short first: the answer, then a shorter
explanation. Ask for more and it expands the same answer rather than starting again. The exchange is
treated as one continuing conversation, so a follow-up is answered as a follow-up — you should not
have to restate what you already said.
</div>

<h2>8. Your credentials</h2>
<p>Provider API keys live in an AES-256-GCM encrypted vault in your user directory, keyed from your
vault master password through Argon2id. Add them on the <span class="mono">/models</span> page.</p>
<ul>
  <li>Nothing is stored in plaintext, and no key is written into a log or a prompt.</li>
  <li>A wrong vault password is <strong>refused</strong> — it will not open an empty vault that then
      overwrites the real one.</li>
  <li>If the vault cannot be decrypted, Rāma refuses to write over it rather than replacing it.</li>
  <li>Vault access is master-only. Other tiers cannot read, write or unlock it.</li>
</ul>

<h2>9. StockMind</h2>
<p>Charts, indicators and analysis over market data stored on your own disk. ${shortcuts.types.length}
chart types (${shortcuts.types.map((t) => esc(t.label)).join(', ')}), with studies, drawing tools and a
volatility projection.</p>
<div class="note"><strong>Two honest limits worth knowing.</strong>
Heikin-Ashi opens and closes are <em>averages</em>, so they are prices that never traded — read
direction from them, never levels. Renko, Line Break, Kagi and Point &amp; Figure advance on
<em>price</em>, not time, so their horizontal axis is an ordering rather than a clock: overlays,
volume, session shading, your fill markers and the projection are all withheld on them, because every
one of those is keyed to real bar times. Rāma says so on the chart rather than drawing them somewhere
plausible.
</div>
<p>Rāma <strong>never places an order.</strong> There is no order-placement channel anywhere in the
application, and broker connections, where configured, are data-only.</p>

<div class="break"></div>
<h2>10. Glossary</h2>
<p>${glossary.count} terms, the same definitions the interface shows when you click a
<span class="mono">?</span>.</p>
${glossarySections}

<div class="break"></div>
<h2>11. When something is wrong</h2>
<table>
  <thead><tr><th>Symptom</th><th>What to do</th></tr></thead>
  <tbody>
    <tr><td>Voice input does nothing</td><td>Check the level chip. Below 2 means nothing can transcribe — install a Whisper binary or add a provider key.</td></tr>
    <tr><td>“Vault locked” will not clear</td><td>The vault password is not the startup passcode. If it is refused, it is the wrong password; the error now says which.</td></tr>
    <tr><td>A page is missing from the rail</td><td>Pages are filtered by access tier. Check section 5.</td></tr>
    <tr><td>Something in the environment is broken</td><td><span class="mono">node start.cjs --diagnose</span>, then <span class="mono">--repair</span>.</td></tr>
    <tr><td>A chart study draws nothing</td><td>It will say why — usually too few bars for the period, or a study withheld on that interval or chart type.</td></tr>
  </tbody>
</table>

<h2>12. What this guide does not cover</h2>
<p>Stated plainly rather than left to be discovered:</p>
<ul>
  <li><strong>The Python analysis engine has not run on this machine.</strong> Its pinned
      <span class="mono">numpy</span> needs CPython 3.12 and a newer Python is installed, so engine-backed
      features — backtests, the projection's numbers, the advanced analytics — are present in the
      interface but unexercised here.</li>
  <li><strong>Voice input is unavailable until a transcriber is installed</strong>, as section 7 explains.</li>
  <li>Features behind an access tier you do not hold are not described in operational detail.</li>
</ul>
<p class="small">Generated ${esc(generatedAt)} from the Rāma AGI source tree. Regenerate with
<span class="mono">npm run guide</span> after any change to pages, capabilities, shortcuts or the glossary.</p>

</body></html>`;
}

// ── Main ────────────────────────────────────────────────────────────────────
const pages = loadPages();
const caps = loadCapabilities();
const glossary = await loadGlossary();
const shortcuts = loadShortcuts();
const voice = loadVoice();

console.log(`\nRama user guide`);
console.log(`  pages        ${pages.length}`);
console.log(`  capabilities ${caps.caps.length} across ${caps.tiers.length} tiers`);
console.log(`  glossary     ${glossary.count} terms`);
console.log(`  shortcuts    ${shortcuts.rows.length} rows, ${shortcuts.types.length} chart types`);
console.log(`  voice        ${voice.candidates.length} local candidates`);

const html = buildHtml({
  pages, caps, glossary, shortcuts, voice,
  generatedAt: new Date().toISOString().slice(0, 10),
});

fs.mkdirSync(OUT_DIR, { recursive: true });
const htmlPath = path.join(OUT_DIR, '.UserGuide.tmp.html');
fs.writeFileSync(htmlPath, html, 'utf8');

let browser = null;
const tried = [];
for (const channel of ['msedge', 'chrome']) {
  try { browser = await chromium.launch({ channel }); break; }
  catch (err) { tried.push(`${channel}: ${String(err.message).split('\n')[0]}`); }
}
if (!browser) {
  fs.unlinkSync(htmlPath);
  fail(`no installed browser channel launched, so the PDF cannot be printed — ${tried.join(' | ')}`);
}

try {
  const page = await browser.newPage();
  await page.goto(`file://${htmlPath.replace(/\\/g, '/')}`, { waitUntil: 'load' });
  await page.pdf({
    path: OUT_PDF,
    format: 'A4',
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: '<div style="font:7pt \'Segoe UI\',sans-serif;color:#8a929c;width:100%;'
      + 'padding:0 16mm;">Rāma AGI — User Guide</div>',
    footerTemplate: '<div style="font:7pt \'Segoe UI\',sans-serif;color:#8a929c;width:100%;'
      + 'padding:0 16mm;text-align:right;">'
      + '<span class="pageNumber"></span> / <span class="totalPages"></span></div>',
    margin: { top: '16mm', bottom: '16mm', left: '14mm', right: '14mm' },
  });
} finally {
  await browser.close();
  fs.unlinkSync(htmlPath);
}

const bytes = fs.statSync(OUT_PDF).size;
if (bytes < 20_000) fail(`the PDF is only ${bytes} bytes, which is too small to be the real guide`);
console.log(`\n  written ${path.relative(ROOT, OUT_PDF)} — ${(bytes / 1024).toFixed(1)} kB\n`);
