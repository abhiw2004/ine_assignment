import { config } from '../config.js';
import { httpJson } from '../util/http.js';
import { logger } from '../util/logger.js';

/**
 * Lightweight-HTTP layer for the parts of the store that are clean JSON:
 *   - GET /api/v2/listings?page&limit  -> catalog (no price/stock, search params ignored)
 *   - GET /api/v2/items/{id}           -> product metadata incl. options + specs
 *
 * Price/stock are NOT here — they are interaction-gated + WASM/XOR-encoded and
 * are handled by the Playwright scraper (see scraper/extract.js). This split is
 * the deliberate "lightweight HTTP where possible, headless only where the page
 * genuinely requires it" judgment call.
 */

const PAGE_LIMIT = 60; // server caps perPage at 60 regardless of `limit`

// in-memory caches
let catalogCache = { at: 0, items: [] };
const itemCache = new Map(); // id -> { at, data }
const ITEM_TTL = config.catalogTtlMs;

function normalizeListing(r) {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    brand: r.brand,
    category: r.category,
    sku: r.sku,
    description: r.description,
    url: `${config.storeBaseUrl}/item/${r.id}`,
  };
}

/** Fetch (and cache) the full catalog by paginating the listings API. */
export async function getCatalog({ force = false } = {}) {
  const fresh = Date.now() - catalogCache.at < config.catalogTtlMs;
  if (!force && fresh && catalogCache.items.length) return catalogCache.items;

  const first = await httpJson(`${config.storeBaseUrl}/api/v2/listings?page=1&limit=${PAGE_LIMIT}`);
  const totalPages = Math.max(1, first.totalPages || 1);
  const items = [...(first.results || []).map(normalizeListing)];

  // Fetch remaining pages with bounded concurrency (light on the store).
  const pages = [];
  for (let p = 2; p <= totalPages; p++) pages.push(p);
  const CONC = 4;
  for (let i = 0; i < pages.length; i += CONC) {
    const slice = pages.slice(i, i + CONC);
    const results = await Promise.all(slice.map(async (p) => {
      try {
        const j = await httpJson(`${config.storeBaseUrl}/api/v2/listings?page=${p}&limit=${PAGE_LIMIT}`);
        return (j.results || []).map(normalizeListing);
      } catch (err) {
        // A missing page must not poison the whole catalog; log and continue.
        logger.warn(`catalog: page ${p} failed (${err.message})`);
        return [];
      }
    }));
    for (const r of results) items.push(...r);
  }

  // de-dupe by id (pagination can shift while the store mutates)
  const seen = new Set();
  const deduped = items.filter((it) => (seen.has(it.id) ? false : (seen.add(it.id), true)));

  catalogCache = { at: Date.now(), items: deduped };
  logger.info(`catalog: loaded ${deduped.length} products (${totalPages} pages)`);
  return deduped;
}

/**
 * Search the catalog by partial/full name (also matches brand, category, sku).
 * The store API ignores query params, so filtering happens here.
 */
export async function searchProducts(query, { limit = 25 } = {}) {
  const q = (query || '').trim().toLowerCase();
  const items = await getCatalog();
  if (!q) return items.slice(0, limit);

  const scored = [];
  for (const it of items) {
    const name = (it.name || '').toLowerCase();
    const brand = (it.brand || '').toLowerCase();
    const cat = (it.category || '').toLowerCase();
    const sku = (it.sku || '').toLowerCase();
    let score = -1;
    if (name === q) score = 100;
    else if (name.startsWith(q)) score = 80;
    else if (name.includes(q)) score = 60;
    else if (brand.includes(q) || cat.includes(q) || sku.includes(q)) score = 30;
    // token match (all query tokens present in name)
    if (score < 0) {
      const toks = q.split(/\s+/).filter(Boolean);
      if (toks.length && toks.every((t) => name.includes(t))) score = 50;
    }
    if (score >= 0) scored.push({ ...it, score });
  }
  scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return scored.slice(0, limit).map(({ score, ...it }) => it);
}

/** Fetch full product metadata (options, specs) for one product id. */
export async function getItem(id, { force = false } = {}) {
  const cached = itemCache.get(String(id));
  if (!force && cached && Date.now() - cached.at < ITEM_TTL) return cached.data;
  const data = await httpJson(`${config.storeBaseUrl}/api/v2/items/${id}`);
  const norm = {
    id: data.id,
    slug: data.slug,
    name: data.name,
    brand: data.brand,
    category: data.category,
    sku: data.sku,
    description: data.description,
    specs: data.specs || {},
    optionAxis: data.optionAxis || null,
    options: (data.options || []).map((o) => ({ id: o.id, label: o.label })),
    reviews: data.reviews || [],
    url: `${config.storeBaseUrl}/item/${data.id}`,
  };
  itemCache.set(String(id), { at: Date.now(), data: norm });
  return norm;
}

/** Fetch the live UI manifest (rotating class names) — used by the scraper. */
export async function getManifest() {
  return httpJson(`${config.storeBaseUrl}/api/v2/ui/manifest`);
}

export function _resetCatalogCache() {
  catalogCache = { at: 0, items: [] };
  itemCache.clear();
}
