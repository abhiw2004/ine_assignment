/**
 * Normalisation helpers that defeat the store's text obfuscation.
 *
 * The rendered price/stock text can be:
 *  - split per-character with ZERO-WIDTH SPACES between glyphs ("₹\u200B5\u200B,\u200B3\u200B4\u200B5")
 *  - injected with NBSP / zero-width non-joiners
 *  - rendered with FULLWIDTH digits ("５３４５")
 *  - formatted in rotating variants: spaced, euro ("5.345,00"), trailing
 *    ("₹5,345/- (incl. of all taxes)"), lakh ("Rs. 5,345.00"), plain ("₹5,345")
 *
 * We strip invisibles, fold fullwidth->ASCII, drop currency/letters, then parse
 * the numeric string using a separator heuristic that handles both Indian and
 * European grouping.
 */

const INVISIBLE = /[\u200B\u200C\u200D\u2060\uFEFF\u00AD\u180E]/g;
const SPACES = /[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000\u0020]/g;
const CURRENCY = /(?:Rs\.?|INR|₹|Rupees?|\$|US\$|€|£|¥|₡|₦|₨)/gi;

function foldFullwidth(s) {
  return s.replace(/[\uFF10-\uFF19]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xff10 + 48))
    .replace(/\uFF0C/g, ',')   // fullwidth comma
    .replace(/\uFF0E/g, '.')   // fullwidth full stop
    .replace(/\uFF05/g, '%');  // fullwidth percent
}

export function cleanText(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(INVISIBLE, '').replace(SPACES, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Parse a numeric string that may contain ',' and '.' as either thousands or
 * decimal separators. Returns a Number or null.
 */
export function parseNumber(str) {
  let s = cleanText(str).replace(SPACES, '').replace(/\s+/g, '');
  s = foldFullwidth(s);
  if (!s) return null;

  // Case A: ends with <sep><1-2 digits>  => that sep is the decimal point.
  const dec = s.match(/^(.*?)([,.])(\d{1,2})$/);
  if (dec) {
    const intPart = dec[1].replace(/[,.]/g, '');
    const frac = dec[3];
    const n = parseFloat(`${intPart}.${frac}`);
    return Number.isFinite(n) ? n : null;
  }

  // Case B: no decimal (or a separator followed by 3 digits = thousands group).
  const digitsOnly = s.replace(/[,.]/g, '');
  if (!/^\d+$/.test(digitsOnly)) return null;
  const n = parseFloat(digitsOnly);
  return Number.isFinite(n) ? n : null;
}

/**
 * Extract a price (positive number) from arbitrary rendered text.
 * Returns { value, raw } where value is a Number rounded to 2dp, or null.
 */
export function normalizePrice(text) {
  const raw = cleanText(text);
  if (!raw) return { value: null, raw };
  let s = foldFullwidth(raw).replace(CURRENCY, '');
  // drop trailing prose such as "/- (incl. of all taxes)" and any stray letters
  s = s.replace(/\(.*?\)/g, '').replace(/\/-/g, '');
  s = s.replace(/[^0-9.,]/g, '');
  const n = parseNumber(s);
  if (n === null || !Number.isFinite(n) || n <= 0) return { value: null, raw };
  return { value: Math.round(n * 100) / 100, raw };
}

const OUT_OF_STOCK = /\b(out of stock|sold out|unavailable|not available|no stock|currently unavailable)\b/i;

/**
 * Extract stock from the rotating templates:
 *   "<n> units available" | "Last few: <n>" | "Available (<n>)"
 *   | "Stock: <n> remaining" | "Ready to ship · <n> available"
 * Also handles out-of-stock text. `pillClass` (e.g. "avail-yes"/"avail-no")
 * is used as a secondary in-stock signal.
 * Returns { value:int|null, inStock:bool|null, raw }.
 */
export function normalizeStock(text, pillClass = '') {
  const raw = cleanText(text);
  const lower = raw.toLowerCase();
  const pill = String(pillClass || '').toLowerCase();

  const outByPill = /avail-no|out|unavailable/.test(pill);
  const inByPill = /avail-yes|in-stock|available/.test(pill);

  if (OUT_OF_STOCK.test(lower) || (outByPill && !/\d/.test(raw))) {
    return { value: 0, inStock: false, raw };
  }

  // first standalone integer in the string
  const folded = foldFullwidth(raw.replace(INVISIBLE, ''));
  const m = folded.match(/\d[\d,]*/);
  if (m) {
    const n = parseNumber(m[0]);
    if (n !== null && Number.isFinite(n)) {
      const value = Math.max(0, Math.round(n));
      const inStock = value > 0 ? true : (inByPill ? true : false);
      return { value, inStock, raw };
    }
  }

  // No number found: fall back to pill/out-of-stock text signals.
  if (outByPill) return { value: 0, inStock: false, raw };
  if (inByPill) return { value: null, inStock: true, raw };
  return { value: null, inStock: null, raw };
}

/** Extract a percentage like "30% saving" -> 30 */
export function normalizeBadgePct(text) {
  const raw = cleanText(text);
  const m = foldFullwidth(raw).match(/(\d{1,3})\s*%/);
  return m ? parseInt(m[1], 10) : null;
}
