import { Router } from 'express';
import { buildScrapeHistoryCsv } from '../services/csv.js';

const router = Router();

// GET /api/export.csv -> full scrape history (one row per attempt)
router.get('/', async (req, res, next) => {
  try {
    const { csv, count } = await buildScrapeHistoryCsv();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="scrape-history-${stamp}.csv"`);
    res.setHeader('X-Row-Count', String(count));
    res.send(csv);
  } catch (err) { next(err); }
});

export default router;
