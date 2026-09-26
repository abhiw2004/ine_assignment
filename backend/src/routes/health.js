import { Router } from 'express';
import { dbReady } from '../db/supabase.js';
import { config } from '../config.js';

const router = Router();

// GET /health -> liveness for Render + cron warm-up pings
router.get('/', (req, res) => {
  res.json({
    ok: true,
    service: 'price-tracker-backend',
    time: new Date().toISOString(),
    db: dbReady(),
    store: config.storeBaseUrl,
    headed: config.scrapeHeaded,
  });
});

export default router;
