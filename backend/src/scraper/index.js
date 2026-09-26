import { config } from '../config.js';
import { newPage, closeBrowser } from './browser.js';
import { driveAndExtract, ScrapeError } from './extract.js';
import { sleep } from '../util/retry.js';
import { logger } from '../util/logger.js';

/**
 * Scrape ONE (product, option) with retries. Each attempt uses a fresh page so
 * a polluted/half-loaded state never leaks into the next try.
 *
 * Outcome semantics (used by the CSV + scrape log):
 *   success  -> valid price+stock on the first attempt
 *   retried  -> valid price+stock, but only after >=1 retry
 *   failed   -> no valid data after all attempts (nothing is stored)
 */
export async function scrapeOne({ storeProductId, optionLabel, url }) {
  const target = url || `${config.storeBaseUrl}/item/${storeProductId}`;
  const maxAttempts = Math.max(1, config.scrapeRetries);
  const started = Date.now();
  let lastError = null;
  let warnings = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let page = null;
    let context = null;
    const attemptStart = Date.now();
    try {
      ({ context, page } = await newPage());
      const data = await driveAndExtract(page, {
        url: target,
        optionLabel,
        navTimeoutMs: config.navTimeoutMs,
      });
      const latencyMs = Date.now() - started;
      warnings = warnings.concat(data.warnings || []);
      logger.info(
        `scrape ok: item=${storeProductId} opt=${optionLabel} price=${data.price} stock=${data.stock} attempt=${attempt} (${latencyMs}ms)`
      );
      return {
        outcome: attempt === 1 ? 'success' : 'retried',
        attempts: attempt,
        latencyMs,
        data,
        warnings,
        error: null,
      };
    } catch (err) {
      lastError = err;
      const kind = err instanceof ScrapeError ? err.kind : 'error';
      const retryable = err instanceof ScrapeError ? err.retryable : true;
      logger.warn(
        `scrape attempt ${attempt}/${maxAttempts} failed: item=${storeProductId} opt=${optionLabel} kind=${kind} :: ${err.message}`
      );
      if (err && err.detail) logger.debug('scrape error detail', err.detail);

      if (!retryable || attempt === maxAttempts) break;

      // exponential backoff + jitter between attempts; fresh page next loop
      const backoff = Math.min(8000, 500 * Math.pow(2, attempt - 1));
      await sleep(backoff / 2 + Math.random() * (backoff / 2));
    } finally {
      try { if (page) await page.close(); } catch { /* noop */ }
      try { if (context) await context.close(); } catch { /* noop */ }
    }
  }

  return {
    outcome: 'failed',
    attempts: Math.min(maxAttempts, Math.max(1, (lastError && lastError._attempts) || maxAttempts)),
    latencyMs: Date.now() - started,
    data: null,
    warnings,
    error: {
      kind: lastError instanceof ScrapeError ? lastError.kind : 'error',
      message: lastError ? lastError.message : 'unknown error',
    },
  };
}

/**
 * Scrape a list of targets with bounded concurrency. On the Render free tier
 * (512MB) keep concurrency at 1 — Chromium is memory-hungry.
 */
export async function scrapeMany(targets, { concurrency = config.scrapeConcurrency, onResult } = {}) {
  const results = [];
  const queue = [...targets];
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (queue.length) {
      const t = queue.shift();
      const r = await scrapeOne(t);
      results.push({ target: t, result: r });
      if (onResult) { try { await onResult(t, r); } catch (e) { logger.warn(`onResult: ${e.message}`); } }
    }
  });
  await Promise.all(workers);
  return results;
}

export { closeBrowser };
