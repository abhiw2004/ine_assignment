import express from 'express';
import cors from 'cors';
import { config, hasDb } from './config.js';
import { logger } from './util/logger.js';
import { closeBrowser } from './scraper/index.js';

import healthRoutes from './routes/health.js';
import catalogRoutes from './routes/catalog.js';
import trackedRoutes from './routes/tracked.js';
import exportRoutes from './routes/export.js';
import scrapeRoutes from './routes/scrape.js';
import alertRoutes from './routes/alerts.js';

const app = express();

app.set('trust proxy', true);
app.use(cors({ origin: config.corsOrigin === '*' ? true : config.corsOrigin.split(',') }));
app.use(express.json({ limit: '1mb' }));

// request log (concise)
app.use((req, res, next) => {
  const t = Date.now();
  res.on('finish', () => {
    if (req.path.startsWith('/api') || req.path === '/health') {
      logger.info(`${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - t}ms`);
    }
  });
  next();
});

app.get('/', (req, res) => {
  res.json({
    service: 'INE Product Price Tracker — backend',
    health: '/health',
    endpoints: [
      'GET  /api/catalog/search?q=',
      'GET  /api/catalog/item/:id',
      'GET  /api/tracked',
      'POST /api/tracked',
      'GET  /api/tracked/:id',
      'PATCH/DELETE /api/tracked/:id',
      'POST /api/tracked/:id/scrape',
      'GET  /api/export.csv',
      'POST /api/scrape/run   (cron; header x-cron-secret)',
      'GET  /api/scrape/config',
      'GET  /api/alerts',
    ],
    dbConfigured: hasDb,
  });
});

app.use('/health', healthRoutes);
app.use('/api/health', healthRoutes);
app.use('/api/catalog', catalogRoutes);
app.use('/api/tracked', trackedRoutes);
app.use('/api', exportRoutes);           // -> /api/export.csv
app.use('/api/scrape', scrapeRoutes);
app.use('/api/alerts', alertRoutes);

// 404
app.use((req, res) => res.status(404).json({ error: `not found: ${req.method} ${req.path}` }));

// central error handler
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || (err.name === 'HttpError' ? 502 : 500);
  logger.error(`${req.method} ${req.originalUrl} -> ${status}: ${err.message}`);
  if (err.stack && config.env !== 'production') logger.debug(err.stack);
  res.status(status).json({ error: err.message || 'internal error' });
});

const server = app.listen(config.port, () => {
  logger.info(`backend listening on :${config.port} (env=${config.env}, db=${hasDb ? 'ready' : 'NOT configured'})`);
  if (!hasDb) {
    logger.warn('Supabase env vars missing — persistence endpoints will fail until configured. See .env.example');
  }
});

// graceful shutdown: always close Chromium so Render doesn't leak memory
async function shutdown(signal) {
  logger.info(`${signal} received — shutting down`);
  try { await closeBrowser(); } catch { /* noop */ }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 8000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export default app;
