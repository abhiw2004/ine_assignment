import { Router } from 'express';
import { getAlerts } from '../db/trackedRepo.js';

const router = Router();

// GET /api/alerts?limit=50&trackedId=...
router.get('/', async (req, res, next) => {
  try {
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const trackedId = req.query.trackedId || null;
    const rows = await getAlerts({ limit, trackedId });
    res.json({ count: rows.length, results: rows });
  } catch (err) { next(err); }
});

export default router;
