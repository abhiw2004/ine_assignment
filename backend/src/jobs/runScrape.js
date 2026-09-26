/**
 * Scrape job entry point.
 *
 * Modes:
 *  1) Scheduled pass (default): scrape all active+due tracked products.
 *     Requires Supabase. This is the local equivalent of what cron-job.org
 *     triggers via POST /api/scrape/run.
 *        node src/jobs/runScrape.js [--force]
 *
 *  2) Ad-hoc (no DB needed): scrape a specific product+option directly and
 *     print the result. Ideal for the headed/observable screen-recording.
 *        node src/jobs/runScrape.js --adhoc --id 2457 --option "Single"
 *        node src/jobs/runScrape.js --adhoc            # runs a small demo list
 *
 *  3) Loop (local dev convenience): keep the process alive and run the
 *     scheduled pass on an interval. On a free-tier backend prefer the
 *     external cron (cron-job.org) hitting /api/scrape/run instead.
 *        node src/jobs/runScrape.js --loop --interval-min 120
 *
 * Headed mode: set SCRAPE_HEADED=true (npm run scrape:headed) to watch Chromium.
 */
import { config } from '../config.js';
import { logger } from '../util/logger.js';
import { scrapeOne, closeBrowser } from '../scraper/index.js';
import { runScheduledScrape } from '../services/scrapeService.js';
import { getItem } from '../store/catalog.js';
import { dbReady } from '../db/supabase.js';

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const get = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };

// A small, stable demo list for the headed recording (varied option axes).
const DEMO_TARGETS = [
  { storeProductId: 2457, optionLabel: 'Single' },
  { storeProductId: 2643, optionLabel: 'Pro kit' },
  { storeProductId: 2788, optionLabel: 'Stage bundle' },
];

function printResult(label, r) {
  console.log(`\n=== ${label} => ${r.outcome.toUpperCase()} (attempts: ${r.attempts}, ${r.latencyMs}ms) ===`);
  if (r.data) {
    const d = r.data;
    console.log(`  price          : ${d.price}  (raw: "${d.rawPriceText}")`);
    console.log(`  stock          : ${d.stock}  inStock=${d.inStock}  (raw: "${d.rawStockText}")`);
    console.log(`  mrp / badge    : ${d.mrp} / ${d.badgePct}%`);
    console.log(`  seller         : ${d.seller}`);
    console.log(`  rating         : ${d.rating}`);
    console.log(`  delivery       : ${d.delivery}`);
    console.log(`  fingerprint    : ${d.fingerprint}`);
    console.log(`  quoteStatus    : ${d.quoteStatus}  handshakes: ${d.handshakeCount}  pageAttempts: ${d.pageAttempts}`);
    if (d.warnings?.length) console.log(`  warnings       : ${d.warnings.join('; ')}`);
  } else {
    console.log(`  error          : ${r.error?.kind}: ${r.error?.message}`);
  }
}

async function adhoc() {
  const idArg = get('--id');
  let targets;
  if (idArg) {
    const id = parseInt(idArg, 10);
    let optionLabel = get('--option');
    if (!optionLabel) {
      const item = await getItem(id);
      optionLabel = item.options?.[0]?.label || null;
      console.log(`no --option given; using first option "${optionLabel}" (axis: ${item.optionAxis})`);
    }
    targets = [{ storeProductId: id, optionLabel }];
  } else {
    targets = DEMO_TARGETS;
    console.log(`adhoc demo: scraping ${targets.length} products in ${config.scrapeHeaded ? 'HEADED' : 'headless'} mode`);
  }

  for (const t of targets) {
    const r = await scrapeOne(t);
    printResult(`${t.storeProductId} / ${t.optionLabel}`, r);
  }
  await closeBrowser();
}

async function scheduled(force) {
  if (!dbReady()) {
    logger.error('Supabase is not configured. Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY, or use --adhoc for a DB-free run.');
    process.exitCode = 1;
    return;
  }
  const summary = await runScheduledScrape({ force });
  console.log('\n=== scheduled scrape summary ===');
  console.log(JSON.stringify(summary, null, 2));
}

async function loop(intervalMin) {
  logger.info(`loop mode: running every ${intervalMin} min (Ctrl+C to stop). Prefer external cron on free tier.`);
  const tick = async () => {
    try { await scheduled(true); } catch (e) { logger.error(`loop tick failed: ${e.message}`); }
  };
  await tick();
  setInterval(tick, intervalMin * 60_000);
}

async function main() {
  console.log(`mode: ${config.scrapeHeaded ? 'HEADED (observable)' : 'headless'} | store: ${config.storeBaseUrl}`);
  if (has('--adhoc')) return adhoc();
  if (has('--loop')) {
    const mins = parseInt(get('--interval-min'), 10) || config.defaultIntervalMin;
    return loop(mins);
  }
  return scheduled(has('--force'));
}

main()
  .then(() => { /* let closeBrowser finish */ })
  .catch(async (err) => {
    logger.error(`job failed: ${err.stack || err.message}`);
    await closeBrowser().catch(() => {});
    process.exit(1);
  });
