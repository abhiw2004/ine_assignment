import 'dotenv/config';

function bool(v, d = false) {
  if (v === undefined || v === null || v === '') return d;
  return /^(1|true|yes|on)$/i.test(String(v));
}
function int(v, d) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
}

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: int(process.env.PORT, 8080),

  // --- target store -------------------------------------------------------
  storeBaseUrl: (process.env.STORE_BASE_URL || 'https://demo.inelabteamdev.com').replace(/\/$/, ''),

  // --- database (Supabase) ------------------------------------------------
  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',

  // --- scraping -----------------------------------------------------------
  scrapeHeaded: bool(process.env.SCRAPE_HEADED, false),
  scrapeSlowMo: int(process.env.SCRAPE_SLOW_MO, 0),
  scrapeTimeoutMs: int(process.env.SCRAPE_TIMEOUT_MS, 45000),
  scrapeRetries: int(process.env.SCRAPE_RETRIES, 4),       // attempts per product per run
  scrapeConcurrency: int(process.env.SCRAPE_CONCURRENCY, 1), // keep at 1 on free tier (RAM)
  navTimeoutMs: int(process.env.NAV_TIMEOUT_MS, 30000),
  httpTimeoutMs: int(process.env.HTTP_TIMEOUT_MS, 20000),
  httpRetries: int(process.env.HTTP_RETRIES, 4),
  userAgent: process.env.USER_AGENT ||
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',

  // --- scheduling / cron --------------------------------------------------
  cronSecret: process.env.CRON_SECRET || '',
  defaultIntervalMin: int(process.env.DEFAULT_INTERVAL_MIN, 120), // every 2 hours

  // --- cors ---------------------------------------------------------------
  corsOrigin: process.env.CORS_ORIGIN || '*',

  // --- alerts (bonus) -----------------------------------------------------
  alertsEnabled: bool(process.env.ALERTS_ENABLED, true),
  priceDropPct: int(process.env.PRICE_DROP_PCT, 0), // 0 = alert on any drop
  sendgridKey: process.env.SENDGRID_API_KEY || '',
  alertEmailTo: process.env.ALERT_EMAIL_TO || '',
  alertEmailFrom: process.env.ALERT_EMAIL_FROM || 'price-tracker@example.com',

  // --- catalog cache ------------------------------------------------------
  catalogTtlMs: int(process.env.CATALOG_TTL_MS, 15 * 60 * 1000),
};

export const hasDb = Boolean(config.supabaseUrl && config.supabaseServiceKey);
