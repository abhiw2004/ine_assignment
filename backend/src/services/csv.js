import { getLogsWithProduct } from '../db/trackedRepo.js';

/** RFC-4180 field escaping. */
function csvField(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function toCsv(rows) {
  const header = [
    'product_id', 'product_name', 'option', 'timestamp_utc',
    'price', 'stock', 'outcome',
  ];
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push([
      csvField(r.product_id),
      csvField(r.product_name),
      csvField(r.option),
      csvField(r.timestamp_utc),
      csvField(r.price),
      csvField(r.stock),
      csvField(r.outcome),
    ].join(','));
  }
  // CRLF per RFC-4180; UTF-8 BOM so Excel renders symbols correctly
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}

/**
 * Build the full scrape-history CSV: one row per scrape attempt.
 * Failed attempts are included with price and stock left empty.
 */
export async function buildScrapeHistoryCsv() {
  const logs = await getLogsWithProduct();
  const rows = logs.map((l) => {
    const tp = l.tracked_products || {};
    const failed = l.outcome === 'failed';
    return {
      product_id: tp.store_product_id ?? '',
      product_name: tp.name ?? '',
      option: tp.option_label ?? '',
      // ISO 8601 UTC
      timestamp_utc: l.created_at ? new Date(l.created_at).toISOString() : '',
      price: failed || l.price == null ? '' : Number(l.price),
      stock: failed || l.stock == null ? '' : Number(l.stock),
      outcome: l.outcome,
    };
  });
  return { csv: toCsv(rows), count: rows.length };
}
