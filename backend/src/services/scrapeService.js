import { config } from '../config.js';
import { logger } from '../util/logger.js';
import { scrapeOne, closeBrowser } from '../scraper/index.js';
import {
  listTracked, insertHistory, insertLog, updateTracked, insertAlert,
} from '../db/trackedRepo.js';
import { detectAndRecordAlerts } from './alertService.js';

const scraperMode = () => (config.scrapeHeaded ? 'headed' : 'headless');

/** A tracked product is due if never scraped, or its interval has elapsed. */
export function isDue(t, now = Date.now()) {
  if (!t.last_scraped_at) return true;
  const intervalMin = t.scrape_interval_min || config.defaultIntervalMin;
  const elapsed = now - new Date(t.last_scraped_at).getTime();
  // 30s skew tolerance so a cron firing slightly early still counts as due
  return elapsed >= intervalMin * 60_000 - 30_000;
}

/** Simple bounded-concurrency pool. */
async function pool(items, worker, concurrency) {
  const results = [];
  const queue = [...items.entries()];
  const runners = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (queue.length) {
      const [idx, item] = queue.shift();
      results[idx] = await worker(item, idx);
    }
  });
  await Promise.all(runners);
  return results;
}

/**
 * Scrape a single tracked row, persist honestly, and update its snapshot.
 * - success/retried -> write price_history + scrape_logs, update snapshot, alerts
 * - failed          -> write scrape_logs ONLY (null price/stock); never store bad data
 */
export async function scrapeTrackedRow(t) {
  const target = {
    storeProductId: t.store_product_id,
    optionLabel: t.option_label,
    url: t.url,
  };
  const startedAt = new Date().toISOString();
  const r = await scrapeOne(target);

  if (r.outcome === 'failed') {
    const isStructure = r.error && r.error.kind === 'structure';
    await insertLog(t.id, {
      outcome: 'failed',
      attempts: r.attempts,
      price: null,
      stock: null,
      inStock: null,
      latencyMs: r.latencyMs,
      error: r.error ? `${r.error.kind}: ${r.error.message}` : 'failed',
      structureChanged: isStructure,
      scraperMode: scraperMode(),
      createdAt: startedAt,
    });
    if (isStructure) {
      await insertAlert(t.id, {
        kind: 'structure_changed',
        message: `Page structure changed / offer panel missing for ${t.name} (${t.option_label}); scrape failed.`,
      }).catch(() => {});
      await updateTracked(t.id, { last_scraped_at: startedAt, last_outcome: 'failed' }).catch(() => {});
    } else {
      await updateTracked(t.id, { last_scraped_at: startedAt, last_outcome: 'failed' }).catch(() => {});
    }
    logger.warn(`stored FAILED log for ${t.name} (${t.option_label}): ${r.error?.message}`);
    return { tracked: t, result: r, stored: false, structureChanged: isStructure };
  }

  const d = r.data;
  const structureChanged = !!(t.structure_fp && d.fingerprint && t.structure_fp !== d.fingerprint);

  await insertHistory(t.id, { ...d, scrapedAt: startedAt });
  await insertLog(t.id, {
    outcome: r.outcome,
    attempts: r.attempts,
    price: d.price,
    stock: d.stock,
    inStock: d.inStock,
    latencyMs: r.latencyMs,
    error: r.warnings && r.warnings.length ? r.warnings.join('; ') : null,
    structureChanged,
    rawPriceText: d.rawPriceText,
    rawStockText: d.rawStockText,
    scraperMode: scraperMode(),
    createdAt: startedAt,
  });

  await detectAndRecordAlerts(t, d);
  if (structureChanged) {
    await insertAlert(t.id, {
      kind: 'structure_changed',
      message: `Page structure changed for ${t.name} (${t.option_label}) — fingerprint "${t.structure_fp}" → "${d.fingerprint}". Extraction still succeeded this run.`,
    }).catch(() => {});
  }

  await updateTracked(t.id, {
    last_price: d.price,
    last_stock: d.stock,
    last_in_stock: d.inStock,
    last_scraped_at: startedAt,
    last_outcome: r.outcome,
    structure_fp: d.fingerprint,
  });

  return { tracked: t, result: r, stored: true, structureChanged };
}

/**
 * Run a scheduled scrape pass over all active (and due) tracked products.
 * Triggered by cron-job.org every 2 hours, or manually.
 */
export async function runScheduledScrape({ ids = null, force = false, keepBrowser = false } = {}) {
  let tracked = await listTracked({ activeOnly: true });

  if (ids && ids.length) {
    const set = new Set(ids.map(String));
    tracked = tracked.filter((t) => set.has(String(t.id)) || set.has(String(t.store_product_id)));
  }
  if (!force) tracked = tracked.filter((t) => isDue(t));

  const summary = {
    startedAt: new Date().toISOString(),
    considered: tracked.length,
    success: 0, retried: 0, failed: 0,
    structureChanged: 0,
    results: [],
  };

  logger.info(`scheduled scrape: ${tracked.length} product(s) due`);

  await pool(tracked, async (t) => {
    try {
      const out = await scrapeTrackedRow(t);
      summary[out.result.outcome] = (summary[out.result.outcome] || 0) + 1;
      if (out.structureChanged) summary.structureChanged += 1;
      summary.results.push({
        id: t.id,
        name: t.name,
        option: t.option_label,
        outcome: out.result.outcome,
        attempts: out.result.attempts,
        price: out.result.data?.price ?? null,
        stock: out.result.data?.stock ?? null,
        structureChanged: out.structureChanged,
        error: out.result.error?.message ?? null,
      });
    } catch (err) {
      summary.failed += 1;
      summary.results.push({ id: t.id, name: t.name, option: t.option_label, outcome: 'failed', error: err.message });
      logger.error(`scrape pass error for ${t.name}: ${err.message}`);
      // still record an honest failed log
      await insertLog(t.id, {
        outcome: 'failed', attempts: 1, price: null, stock: null, inStock: null,
        error: `orchestrator: ${err.message}`, scraperMode: scraperMode(),
      }).catch(() => {});
    }
  }, config.scrapeConcurrency);

  summary.finishedAt = new Date().toISOString();
  if (!keepBrowser) await closeBrowser();
  logger.info('scheduled scrape summary', {
    success: summary.success, retried: summary.retried, failed: summary.failed,
    structureChanged: summary.structureChanged,
  });
  return summary;
}

/** Scrape a single product+option on demand (dashboard "Run now"). */
export async function scrapeNowById(trackedId) {
  const tracked = await listTracked({});
  const t = tracked.find((x) => String(x.id) === String(trackedId));
  if (!t) throw new Error(`tracked product ${trackedId} not found`);
  const out = await scrapeTrackedRow(t);
  await closeBrowser();
  return out;
}
