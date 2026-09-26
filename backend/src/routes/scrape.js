import { Router } from 'express';
import { config } from '../config.js';
import { runScheduledScrape } from '../services/scrapeService.js';
import { logger } from '../util/logger.js';

const router = Router();

/**
 * Cron auth: cron-job.org sends a shared secret. Accept it via header
 * `x-cron-secret` (preferred) or `?secret=`. If CRON_SECRET is unset we allow
 * the call (local dev only) but warn loudly.
 */
function cronAuthorized(req) {
  if (!config.cronSecret) {
    logger.warn('CRON_SECRET is not set — /api/scrape/run is UNPROTECTED (dev only!)');
    return true;
  }
  const provided = req.get('x-cron-secret') || req.query.secret || '';
  return provided === config.cronSecret;
}

// POST /api/scrape/run -> the scheduled entry point hit by cron-job.org (every 2h)
router.post('/run', async (req, res, next) => {
  if (!cronAuthorized(req)) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  try {
    const force = req.query.force === 'true' || req.body?.force === true;
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : null;
    // Respond fast for very large passes? Keep synchronous so cron sees the result.
    const summary = await runScheduledScrape({ ids, force });
    res.json(summary);
  } catch (err) { next(err); }
});

// GET /api/scrape/config -> non-secret scheduling info for the dashboard
router.get('/config', (req, res) => {
  res.json({
    defaultIntervalMin: config.defaultIntervalMin,
    scrapeRetries: config.scrapeRetries,
    scrapeConcurrency: config.scrapeConcurrency,
    headed: config.scrapeHeaded,
    cronProtected: !!config.cronSecret,
    storeBaseUrl: config.storeBaseUrl,
  });
});

export default router;
