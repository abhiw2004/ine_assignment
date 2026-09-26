import { db, unwrap } from './supabase.js';

// ---------------------------------------------------------------------------
// tracked_products
// ---------------------------------------------------------------------------

export async function listTracked({ activeOnly = false } = {}) {
  let q = db().from('tracked_products').select('*').order('created_at', { ascending: true });
  if (activeOnly) q = q.eq('active', true);
  return unwrap(await q, 'listTracked');
}

export async function getTracked(id) {
  const rows = unwrap(
    await db().from('tracked_products').select('*').eq('id', id).maybeSingle(),
    'getTracked'
  );
  return rows;
}

export async function findTracked(storeProductId, optionId) {
  return unwrap(
    await db()
      .from('tracked_products')
      .select('*')
      .eq('store_product_id', storeProductId)
      .eq('option_id', optionId)
      .maybeSingle(),
    'findTracked'
  );
}

export async function upsertTracked(row) {
  // unique(store_product_id, option_id) -> upsert keeps a single tracking entry
  const payload = {
    store_product_id: row.storeProductId,
    slug: row.slug ?? null,
    name: row.name,
    brand: row.brand ?? null,
    category: row.category ?? null,
    option_axis: row.optionAxis ?? null,
    option_id: row.optionId,
    option_label: row.optionLabel,
    url: row.url,
    active: row.active ?? true,
    scrape_interval_min: row.scrapeIntervalMin ?? 120,
  };
  return unwrap(
    await db()
      .from('tracked_products')
      .upsert(payload, { onConflict: 'store_product_id,option_id' })
      .select()
      .single(),
    'upsertTracked'
  );
}

export async function updateTracked(id, patch) {
  return unwrap(
    await db().from('tracked_products').update(patch).eq('id', id).select().single(),
    'updateTracked'
  );
}

export async function deleteTracked(id) {
  unwrap(await db().from('tracked_products').delete().eq('id', id), 'deleteTracked');
  return true;
}

// ---------------------------------------------------------------------------
// price_history (only successful scrapes)
// ---------------------------------------------------------------------------

export async function insertHistory(trackedId, d) {
  const row = {
    tracked_product_id: trackedId,
    price: d.price,
    stock: d.stock,
    in_stock: d.inStock,
    mrp: d.mrp ?? null,
    badge_pct: d.badgePct ?? null,
    seller: d.seller ?? null,
    rating: d.rating ?? null,
    delivery: d.delivery ?? null,
    raw_price_text: d.rawPriceText ?? null,
    raw_stock_text: d.rawStockText ?? null,
    scraped_at: d.scrapedAt || new Date().toISOString(),
  };
  return unwrap(await db().from('price_history').insert(row).select().single(), 'insertHistory');
}

export async function getHistory(trackedId, { limit = 500 } = {}) {
  return unwrap(
    await db()
      .from('price_history')
      .select('*')
      .eq('tracked_product_id', trackedId)
      .order('scraped_at', { ascending: true })
      .limit(limit),
    'getHistory'
  );
}

// ---------------------------------------------------------------------------
// scrape_logs (every attempt/run)
// ---------------------------------------------------------------------------

export async function insertLog(trackedId, log) {
  const row = {
    tracked_product_id: trackedId,
    outcome: log.outcome,                 // success | retried | failed
    attempts: log.attempts ?? 1,
    price: log.price ?? null,
    stock: log.stock ?? null,
    in_stock: log.inStock ?? null,
    latency_ms: log.latencyMs ?? null,
    error: log.error ?? null,
    structure_changed: !!log.structureChanged,
    raw_price_text: log.rawPriceText ?? null,
    raw_stock_text: log.rawStockText ?? null,
    scraper_mode: log.scraperMode ?? (process.env.SCRAPE_HEADED === 'true' ? 'headed' : 'headless'),
    created_at: log.createdAt || new Date().toISOString(),
  };
  return unwrap(await db().from('scrape_logs').insert(row).select().single(), 'insertLog');
}

export async function getLogs(trackedId, { limit = 200 } = {}) {
  return unwrap(
    await db()
      .from('scrape_logs')
      .select('*')
      .eq('tracked_product_id', trackedId)
      .order('created_at', { ascending: false })
      .limit(limit),
    'getLogs'
  );
}

/** Full log joined with product info — the source for the CSV export. */
export async function getLogsWithProduct({ limit = 100000 } = {}) {
  return unwrap(
    await db()
      .from('scrape_logs')
      .select('*, tracked_products(store_product_id, name, option_label, option_id)')
      .order('created_at', { ascending: true })
      .limit(limit),
    'getLogsWithProduct'
  );
}

// ---------------------------------------------------------------------------
// alerts (bonus)
// ---------------------------------------------------------------------------

export async function insertAlert(trackedId, a) {
  const row = {
    tracked_product_id: trackedId,
    kind: a.kind,
    message: a.message,
    old_value: a.oldValue ?? null,
    new_value: a.newValue ?? null,
    emailed: !!a.emailed,
  };
  return unwrap(await db().from('alerts').insert(row).select().single(), 'insertAlert');
}

export async function getAlerts({ limit = 50, trackedId = null } = {}) {
  let q = db()
    .from('alerts')
    .select('*, tracked_products(name, option_label, store_product_id)')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (trackedId) q = q.eq('tracked_product_id', trackedId);
  return unwrap(await q, 'getAlerts');
}
