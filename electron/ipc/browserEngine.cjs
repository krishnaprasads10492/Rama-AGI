'use strict';

/**
 * browserEngine.cjs — Playwright-powered browser automation for Rāma.
 * Gives Rāma full internet access via a controlled, isolated browser context.
 * All destructive actions (form submit, login, download) require master confirmation.
 */

let playwright = null;
try {
  playwright = require('playwright');
} catch {
  console.warn('[browserEngine] playwright not installed — browser automation disabled');
}

const runtime = require('../lib/browserRuntime.cjs');

/**
 * Which browser to drive, discovered once and reused (Section 94).
 *
 * `require('playwright')` succeeding is NOT the same as having a browser. On this machine the module
 * is pinned and present while its bundled Chromium is absent — nothing ever ran `playwright install`
 * — yet Edge and Chrome are both here and both launch through Playwright's `channel` option. So
 * every launch below goes through discovery rather than assuming the bundled binary, which turns
 * "playwright not installed" from a dead end into a browser master already owns.
 */
let _runtime = null;
function browserRuntime() {
  if (!_runtime) {
    _runtime = runtime.discover({
      exists: (p) => { try { return require('fs').existsSync(p); } catch { return false; } },
      playwright,
    });
    if (_runtime.chosen) {
      console.warn(`[browserEngine] driving ${_runtime.chosen.label} (${_runtime.chosen.how})`);
    } else if (_runtime.reason) {
      console.warn(`[browserEngine] no drivable browser: ${_runtime.reason}`);
    }
  }
  return _runtime;
}

/** Launch the best available browser, or report why none can be. */
async function launchChosen(extra = {}) {
  const found = browserRuntime();
  const opts = runtime.launchOptions(found, { headless: true, args: ['--no-sandbox'], ...extra });
  if (!opts) {
    const err = new Error(found.reason || 'no drivable browser found');
    err.noBrowser = true;
    throw err;
  }
  return playwright.chromium.launch(opts);
}

const path = require('path');
const fs   = require('fs');
const os   = require('os');
const { app } = require('electron');
const net  = require('../lib/http.cjs');

// ─── State ────────────────────────────────────────────────────────────────────
let browser     = null;
let browserCtx  = null;
const pages     = {};        // { [pageId]: Page }
let pageCounter = 0;

const downloadQueue  = [];
const downloadMap    = {};

// Auto-close browser after 5 min inactivity (prevents 200MB idle memory waste)
let _browserLastUsed = 0;
let _autoCloseTimer  = null;
function touchBrowser() {
  _browserLastUsed = Date.now();
  clearTimeout(_autoCloseTimer);
  _autoCloseTimer = setTimeout(async () => {
    if (browser && Date.now() - _browserLastUsed > 5 * 60 * 1000) {
      await closeBrowser();
      console.warn('[browserEngine] Auto-closed after 5min inactivity — saves ~200MB RAM');
    }
  }, 5 * 60 * 1000 + 2000);
}

// ─── Register ────────────────────────────────────────────────────────────────
function register(ipcMain) {

  // ── Launch browser ────────────────────────────────────────────────────────
  ipcMain.handle('browser:launch', async (_e, opts = {}) => {
    if (!playwright) return { ok: false, error: 'playwright not installed' };
    if (browser) return { ok: true, message: 'already running' };
    try {
      browser = await launchChosen({
        headless: opts.headless !== false,   // headless by default
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });
      browserCtx = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
        viewport:  { width: 1280, height: 800 },
        acceptDownloads: true,
      });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ── Close browser ─────────────────────────────────────────────────────────
  ipcMain.handle('browser:close', async () => {
    await closeBrowser();
    return { ok: true };
  });

  // ── Open page ─────────────────────────────────────────────────────────────
  ipcMain.handle('browser:open-page', async (_e, url) => {
    if (!browserCtx) return { ok: false, error: 'Browser not launched' };
    touchBrowser();
    try {
      const id   = ++pageCounter;
      const page = await browserCtx.newPage();
      pages[id]  = page;
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      const title = await page.title();
      return { ok: true, id, title, url: page.url() };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ── Navigate existing page ────────────────────────────────────────────────
  ipcMain.handle('browser:navigate', async (_e, id, url) => {
    const page = pages[id];
    if (!page) return { ok: false, error: 'Page not found' };
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      return { ok: true, url: page.url(), title: await page.title() };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ── Read page content ─────────────────────────────────────────────────────
  ipcMain.handle('browser:get-content', async (_e, id) => {
    const page = pages[id];
    if (!page) return { ok: false, error: 'Page not found' };
    try {
      const text  = await page.evaluate(() => document.body.innerText);
      const title = await page.title();
      const url   = page.url();
      const links = await page.evaluate(() =>
        Array.from(document.querySelectorAll('a[href]'))
          .map(a => ({ text: a.innerText.trim(), href: a.href }))
          .filter(l => l.href.startsWith('http'))
          .slice(0, 100)
      );
      return { ok: true, text, title, url, links };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  /**
   * Which browsers Rāma can drive, and which it chose (Section 94).
   *
   * Surfaced so "web search does not work" is a diagnosable statement rather than a guess. Reports
   * every candidate with the evidence that found it, and when none is drivable, the exact remedy.
   */
  ipcMain.handle('browser:runtime', async () => {
    const found = browserRuntime();
    return {
      ok: !!found.chosen,
      playwrightPresent: found.playwrightPresent,
      chosen: found.chosen
        ? { id: found.chosen.id, label: found.chosen.label, how: found.chosen.how, path: found.chosen.executablePath }
        : null,
      available: found.available.map(b => ({ id: b.id, label: b.label, how: b.how, path: b.executablePath })),
      reason: found.reason,
    };
  });

  // ── Search the web ────────────────────────────────────────────────────────
  /**
   * DEFAULT ENGINE IS BING, AND THAT IS A MEASURED CHOICE (Section 94).
   *
   * This defaulted to DuckDuckGo and would have returned zero results even with a working browser:
   * probed through a real Edge and a real Chrome, DDG serves an empty shell — 305 bytes, no result
   * nodes under any selector — because it blocks automated requests. Bing returned ten results
   * through `.b_algo`, a selector already written below. Fixing only the missing browser would have
   * produced a search that launches, succeeds, and finds nothing.
   *
   * DuckDuckGo stays selectable: a blocked engine may work again, and removing it would be a
   * capability regression. It is simply no longer the default.
   */
  ipcMain.handle('browser:search', async (_e, query, engine = 'bing') => {
    if (!playwright) return { ok: false, error: 'playwright not installed' };
    try {
      // Ensure browser is up
      if (!browser) {
        browser    = await launchChosen();
        browserCtx = await browser.newContext({
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
        });
      }
      const page = await browserCtx.newPage();
      const urls = {
        duckduckgo: `https://duckduckgo.com/?q=${encodeURIComponent(query)}&ia=web`,
        bing:       `https://www.bing.com/search?q=${encodeURIComponent(query)}`,
        google:     `https://www.google.com/search?q=${encodeURIComponent(query)}`,
      };
      await page.goto(urls[engine] || urls.bing, { waitUntil: 'domcontentloaded', timeout: 20000 });

      // Extract results
      const results = await page.evaluate(() => {
        const items = [];
        // DuckDuckGo / generic result extraction
        const selectors = [
          '.result__body',        // DDG
          '.b_algo',              // Bing
          '.g',                   // Google
          'article',              // Generic
        ];
        for (const sel of selectors) {
          const els = document.querySelectorAll(sel);
          if (els.length > 0) {
            els.forEach((el, i) => {
              if (i >= 8) return;
              const titleEl = el.querySelector('h2,h3,a');
              const linkEl  = el.querySelector('a[href]');
              const descEl  = el.querySelector('p,.result__snippet,.b_caption p');
              items.push({
                title:   titleEl?.innerText?.trim() || '',
                url:     linkEl?.href || '',
                snippet: descEl?.innerText?.trim() || '',
              });
            });
            break;
          }
        }
        return items.filter(r => r.url.startsWith('http'));
      });

      await page.close();
      // `browser` names which one was actually driven, and zero results is reported as such rather
      // than as success with an empty array — an engine that blocks automation looks identical to a
      // query with no matches unless it is said out loud.
      return {
        ok: true,
        query,
        engine,
        results,
        browser: browserRuntime().chosen?.label ?? null,
        note: results.length === 0
          ? `${engine} returned no usable results — it may be blocking automated requests. `
            + 'Try engine "bing".'
          : null,
      };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ── Screenshot ────────────────────────────────────────────────────────────
  ipcMain.handle('browser:screenshot', async (_e, id) => {
    const page = pages[id];
    if (!page) return { ok: false, error: 'Page not found' };
    try {
      const buf = await page.screenshot({ type: 'png', fullPage: false });
      return { ok: true, data: buf.toString('base64') };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ── Execute JS in page ────────────────────────────────────────────────────
  ipcMain.handle('browser:execute-js', async (_e, id, script) => {
    const page = pages[id];
    if (!page) return { ok: false, error: 'Page not found' };
    try {
      const result = await page.evaluate(script);
      return { ok: true, result };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ── Download file ─────────────────────────────────────────────────────────
  ipcMain.handle('browser:download', async (event, url, destDir, filename) => {
    if (!playwright) return { ok: false, error: 'playwright not installed' };
    const dlId   = `dl_${Date.now()}`;
    const dlPath = path.join(destDir || getDownloadDir(), filename || path.basename(new URL(url).pathname) || 'download');
    const entry  = { id: dlId, url, dest: dlPath, status: 'pending', progress: 0, size: 0 };
    downloadQueue.push(entry);
    downloadMap[dlId] = entry;

    // Start in background
    (async () => {
      try {
        if (!browser) {
          browser    = await launchChosen();
          browserCtx = await browser.newContext({ acceptDownloads: true });
        }
        const page = await browserCtx.newPage();
        const [download] = await Promise.all([
          page.waitForEvent('download'),
          page.goto(url, { timeout: 60000 }),
        ]);
        entry.status = 'downloading';
        event.sender.send('browser:download-progress', { id: dlId, status: 'downloading' });

        await download.saveAs(dlPath);
        entry.status   = 'complete';
        entry.progress = 100;
        event.sender.send('browser:download-progress', { id: dlId, status: 'complete', dest: dlPath });
        await page.close();
      } catch (err) {
        entry.status = 'error';
        entry.error  = err.message;
        event.sender.send('browser:download-progress', { id: dlId, status: 'error', error: err.message });
      }
    })();

    return { ok: true, id: dlId, dest: dlPath };
  });

  // ── Get download queue ────────────────────────────────────────────────────
  ipcMain.handle('browser:get-downloads', async () => {
    return { ok: true, data: downloadQueue };
  });

  // ── Close specific page ───────────────────────────────────────────────────
  ipcMain.handle('browser:close-page', async (_e, id) => {
    const page = pages[id];
    if (page) {
      await page.close().catch(() => {});
      delete pages[id];
    }
    return { ok: true };
  });

  // ── List open pages ────────────────────────────────────────────────────────
  ipcMain.handle('browser:list-pages', async () => {
    const list = await Promise.all(
      Object.entries(pages).map(async ([id, page]) => {
        try {
          const title = await page.title();
          const url   = page.url();
          return { id: parseInt(id), title, url };
        } catch {
          return { id: parseInt(id), title: '[closed]', url: '' };
        }
      })
    );
    return { ok: true, data: list };
  });

  // ── Fetch & read a URL (lightweight, no full browser) ─────────────────────
  ipcMain.handle('browser:fetch-url', async (_e, url) => {
    // Shared HTTP client: human headers, circuit breaker, 10MB cap.
    // Keeps this path cheap so we never spin up Chromium just to read a page.
    const res = await net.getHuman(url, { timeout: 15000 });
    if (!res.ok) return { ok: false, error: res.error || `HTTP ${res.status}` };
    return { ok: true, data: res.body };
  });
}

async function closeBrowser() {
  for (const page of Object.values(pages)) {
    await page.close().catch(() => {});
  }
  if (browserCtx) await browserCtx.close().catch(() => {});
  if (browser)    await browser.close().catch(() => {});
  browser = browserCtx = null;
}

function getDownloadDir() {
  return path.join(os.homedir(), 'Downloads', 'RamaAGI');
}

/** For system.cjs's own-footprint reporting — the real PID of the Playwright
 * browser process, if one is running, so its CPU/RAM can be looked up in the
 * live process list. Playwright launches its own Chromium process tree;
 * `browser.process()` is the top one. */
function getBrowserPid() {
  return browser?.process()?.pid ?? null;
}

module.exports = { register, closeBrowser, getBrowserPid };
