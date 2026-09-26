import { chromium } from 'playwright';
import { config } from '../config.js';
import { logger } from '../util/logger.js';

let browserPromise = null;

/** Lazily launch (and reuse) a single Chromium instance for the whole process. */
export function getBrowser() {
  if (!browserPromise) {
    browserPromise = chromium
      .launch({
        headless: !config.scrapeHeaded,
        slowMo: config.scrapeSlowMo,
        // NOTE: avoid --single-process / --no-zygote — they are unstable and can
        // tear the whole browser down when a single context/page is closed.
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--no-first-run',
          '--no-default-browser-check',
        ],
      })
      .then((browser) => {
        // If the browser dies, drop the cached promise so the next call relaunches.
        browser.on('disconnected', () => {
          if (browserPromise && browserPromise.__browser === browser) browserPromise = null;
        });
        browserPromise.__browser = browser;
        return browser;
      })
      .catch((err) => {
        browserPromise = null; // allow retry on next call
        throw err;
      });
  }
  return browserPromise;
}

export async function closeBrowser() {
  if (!browserPromise) return;
  const p = browserPromise;
  browserPromise = null;
  try {
    const b = await p;
    await b.close();
    logger.info('browser closed');
  } catch (err) {
    logger.warn(`closeBrowser: ${err.message}`);
  }
}

/**
 * Create an isolated context+page. Blocks images/media/fonts to cut load time
 * and flakiness (the price lives in the DOM, not in CSS pixels), while keeping
 * JS/XHR/document so the handshake + WASM decode still run.
 */
export async function newPage({ blockResources = true } = {}) {
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent: config.userAgent,
    viewport: { width: 1366, height: 900 },
    locale: 'en-US',
    timezoneId: 'Asia/Kolkata',
    deviceScaleFactor: 1,
  });
  context.setDefaultTimeout(config.navTimeoutMs);

  if (blockResources) {
    await context.route('**/*', (route) => {
      const type = route.request().resourceType();
      if (['image', 'media', 'font'].includes(type)) {
        return route.abort();
      }
      return route.continue();
    });
  }

  const page = await context.newPage();
  page.setDefaultTimeout(config.navTimeoutMs);
  return { context, page };
}
