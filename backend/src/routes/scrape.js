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
//
// Fire-and-forget on purpose. A full pass can take several minutes on the free
// tier (cold start + headless Chromium + retries against a deliberately flaky,
// rate-limiting store), which blows past cron-job.org's timeout and its
// response-size cap ("Timeout" / "Response data too big"). So we acknowledge
// immediately with a tiny 202 body and run the pass in the background. Every
// outcome is persisted to Supabase (price_history + scrape_logs) and shown on
// the dashboard, so cron-job.org only needs to trigger the run. Pair this with a
// keep-warm ping (GET /health every 5 min) so the instance stays up while the
// background pass runs.
router.post('/run', (req, res) => {
  if (!cronAuthorized(req)) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const force = req.query.force === 'true' || req.body?.force === true;
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : null;

  res.status(202).json({ ok: true, accepted: true, at: new Date().toISOString() });

  runScheduledScrape({ ids, force })
    .then((summary) => logger.info('background scheduled scrape finished', {
      considered: summary.considered,
      success: summary.success,
      retried: summary.retried,
      failed: summary.failed,
      structureChanged: summary.structureChanged,
    }))
    .catch((err) => logger.error(`background scheduled scrape failed: ${err.message}`));
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
