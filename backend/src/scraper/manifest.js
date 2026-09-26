import { getManifest } from '../store/catalog.js';
import { logger } from '../util/logger.js';

let cache = { at: 0, data: null };
const TTL = 60_000; // manifest has its own validUntil; re-read at most once a minute

/**
 * The store rotates the CSS class names used for price/stock/etc. via a
 * manifest ({ classes: { priceValue, stock, ... }, priceCarrier, priceTag }).
 * We must read it fresh and never hardcode class names, or the scraper silently
 * breaks when the store re-renders with a new revision.
 */
export async function getManifestFresh({ force = false } = {}) {
  const fresh = Date.now() - cache.at < TTL;
  if (!force && fresh && cache.data) return cache.data;
  try {
    const m = await getManifest();
    cache = { at: Date.now(), data: m };
    return m;
  } catch (err) {
    if (cache.data) {
      logger.warn(`manifest: refresh failed (${err.message}); using stale manifest`);
      return cache.data;
    }
    throw err;
  }
}

/** Class names we depend on, with sane fallbacks if the manifest is missing keys. */
export function manifestClasses(m) {
  const c = (m && m.classes) || {};
  return {
    priceWrap: c.priceWrap || null,
    priceValue: c.priceValue || null,
    mrp: c.mrp || null,
    sale: c.sale || null,
    badge: c.badge || null,
    rating: c.rating || null,
    seller: c.seller || null,
    delivery: c.delivery || null,
    stock: c.stock || null,
  };
}
