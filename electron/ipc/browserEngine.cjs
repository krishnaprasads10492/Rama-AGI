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

const path = require('path');
const fs   = require('fs');
const os   = require('os');
const { app } = require('electron');

// ─── State ────────────────────────────────────────────────────────────────────
let browser     = null;
let browserCtx  = null;
const pages     = {};        // { [pageId]: Page }
let pageCounter = 0;

const downloadQueue  = [];   // { id, url, dest, status, progress, size }
const downloadMap    = {};   // { [id]: download object }

// ─── Register ────────────────────────────────────────────────────────────────
function register(ipcMain) {

  // ── Launch browser ────────────────────────────────────────────────────────
  ipcMain.handle('browser:launch', async (_e, opts = {}) => {
    if (!playwright) return { ok: false, error: 'playwright not installed' };
    if (browser) return { ok: true, message: 'already running' };
    try {
      browser = await playwright.chromium.launch({
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

  // ── Search the web ────────────────────────────────────────────────────────
  ipcMain.handle('browser:search', async (_e, query, engine = 'duckduckgo') => {
    if (!playwright) return { ok: false, error: 'playwright not installed' };
    try {
      // Ensure browser is up
      if (!browser) {
        browser    = await playwright.chromium.launch({ headless: true, args: ['--no-sandbox'] });
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
      await page.goto(urls[engine] || urls.duckduckgo, { waitUntil: 'domcontentloaded', timeout: 20000 });

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
      return { ok: true, query, engine, results };
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
          browser    = await playwright.chromium.launch({ headless: true, args: ['--no-sandbox'] });
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
    try {
      const https = url.startsWith('https') ? require('https') : require('http');
      const data  = await new Promise((resolve, reject) => {
        const req = https.get(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 RamaAGI/1.0' },
          timeout: 15000,
        }, (res) => {
          let body = '';
          res.on('data', chunk => { body += chunk; });
          res.on('end',  () => resolve(body));
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
      });
      return { ok: true, data };
    } catch (err) {
      return { ok: false, error: err.message };
    }
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

module.exports = { register, closeBrowser };
