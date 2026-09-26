import { Router } from 'express';
import { config } from '../config.js';
import { getItem } from '../store/catalog.js';
import {
  listTracked, getTracked, upsertTracked, updateTracked, deleteTracked,
  getHistory, getLogs,
} from '../db/trackedRepo.js';
import { scrapeNowById } from '../services/scrapeService.js';
import { logger } from '../util/logger.js';

const router = Router();

// GET /api/tracked -> all tracked products (dashboard grid)
router.get('/', async (req, res, next) => {
  try {
    const rows = await listTracked({});
    res.json({ count: rows.length, results: rows });
  } catch (err) { next(err); }
});

// POST /api/tracked -> start tracking a (product, option)
// body: { storeProductId, optionId, scrapeIntervalMin?, scrapeNow? }
router.post('/', async (req, res, next) => {
  try {
    const storeProductId = parseInt(req.body?.storeProductId ?? req.body?.id, 10);
    const optionId = String(req.body?.optionId || '').trim();
    if (!Number.isFinite(storeProductId)) return res.status(400).json({ error: 'storeProductId required' });
    if (!optionId) return res.status(400).json({ error: 'optionId required' });

    // Pull authoritative metadata from the store (never trust the client).
    const item = await getItem(storeProductId);
    const opt = (item.options || []).find((o) => o.id === optionId);
    if (!opt) return res.status(400).json({ error: `option "${optionId}" not valid for product ${storeProductId}` });

    const intervalMin = Math.max(5, parseInt(req.body?.scrapeIntervalMin, 10) || config.defaultIntervalMin);

    const row = await upsertTracked({
      storeProductId: item.id,
      slug: item.slug,
      name: item.name,
      brand: item.brand,
      category: item.category,
      optionAxis: item.optionAxis,
      optionId: opt.id,
      optionLabel: opt.label,
      url: item.url,
      scrapeIntervalMin: intervalMin,
      active: true,
    });

    // Kick off a first scrape in the background so the dashboard fills in soon.
    const scrapeNow = req.body?.scrapeNow !== false;
    if (scrapeNow) {
      scrapeNowById(row.id).catch((e) => logger.warn(`initial scrape failed for ${item.name}: ${e.message}`));
    }

    res.status(201).json({ tracked: row, scrapeQueued: scrapeNow });
  } catch (err) { next(err); }
});

// GET /api/tracked/:id -> tracked row + history + logs (detail view)
router.get('/:id', async (req, res, next) => {
  try {
    const t = await getTracked(req.params.id);
    if (!t) return res.status(404).json({ error: 'not found' });
    const [history, logs] = await Promise.all([
      getHistory(t.id, { limit: 1000 }),
      getLogs(t.id, { limit: 200 }),
    ]);
    res.json({ tracked: t, history, logs });
  } catch (err) { next(err); }
});

// PATCH /api/tracked/:id -> update interval / active
router.patch('/:id', async (req, res, next) => {
  try {
    const patch = {};
    if (req.body?.scrapeIntervalMin != null) {
      patch.scrape_interval_min = Math.max(5, parseInt(req.body.scrapeIntervalMin, 10) || config.defaultIntervalMin);
    }
    if (req.body?.active != null) patch.active = !!req.body.active;
    if (!Object.keys(patch).length) return res.status(400).json({ error: 'nothing to update' });
    const row = await updateTracked(req.params.id, patch);
    res.json({ tracked: row });
  } catch (err) { next(err); }
});

// DELETE /api/tracked/:id -> stop tracking
router.delete('/:id', async (req, res, next) => {
  try {
    await deleteTracked(req.params.id);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /api/tracked/:id/scrape -> manual "Run now"
router.post('/:id/scrape', async (req, res, next) => {
  try {
    const out = await scrapeNowById(req.params.id);
    res.json({
      outcome: out.result.outcome,
      attempts: out.result.attempts,
      price: out.result.data?.price ?? null,
      stock: out.result.data?.stock ?? null,
      structureChanged: out.structureChanged,
      error: out.result.error?.message ?? null,
    });
  } catch (err) { next(err); }
});

export default router;
