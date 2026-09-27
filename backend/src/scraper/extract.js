import { cleanText, normalizePrice, normalizeStock, normalizeBadgePct } from './normalize.js';
import { logger } from '../util/logger.js';

/** Typed, retry-classified scrape error. */
export class ScrapeError extends Error {
  constructor(kind, message, { retryable = true, detail = null } = {}) {
    super(message);
    this.name = 'ScrapeError';
    this.kind = kind;            // nav | cookie | option | presence | locked | failed_phase | extract | validate | structure
    this.retryable = retryable;
    this.detail = detail;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Drive one product page and extract price+stock for the selected option.
 *
 * Why a browser is required here (and only here): the quote is gated behind a
 * trusted-presence handshake (>=8 real mousemoves, >=600ms dwell) and the
 * response of /api/v2/items/{id}/quote?opt={opt} is XOR+WebAssembly-decoded in
 * page JS, then rendered with rotating manifest class names, per-character
 * zero-width splitting and hidden decoy nodes. None of that is reproducible
 * (or stable) over plain HTTP, so we let the page do its own decode and read
 * the *visible* result a human would see.
 *
 * @param {import('playwright').Page} page
 * @param {object} o
 * @param {string} o.url            absolute /item/{id} url
 * @param {string} [o.optionLabel]  option chip label to select (e.g. "Single")
 * @param {number} [o.navTimeoutMs]
 * @returns {Promise<object>} quote + diagnostics
 */
export async function driveAndExtract(page, { url, optionLabel = null, navTimeoutMs = 30000 }) {
  const warnings = [];
  const net = { quoteStatus: null, handshakeCount: 0 };

  const onResponse = (res) => {
    const u = res.url();
    if (u.includes('/quote')) net.quoteStatus = res.status();
    if (u.includes('/handshake')) net.handshakeCount += 1;
  };
  page.on('response', onResponse);

  try {
    // 1) navigate -----------------------------------------------------------
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: navTimeoutMs });
    } catch (err) {
      throw new ScrapeError('nav', `navigation failed: ${err.message}`, { retryable: true });
    }

    // 2) wait for the offer panel to mount ---------------------------------
    try {
      await page.waitForSelector('.offer-panel', { timeout: navTimeoutMs, state: 'attached' });
    } catch {
      throw new ScrapeError('structure', 'offer panel never mounted (page structure changed?)', {
        retryable: true,
      });
    }

    // 3) dismiss cookie banner (can overlay and swallow pointer events) -----
    try {
      const cookie = page.locator('button', { hasText: /allow cookies|accept|reject cookies/i }).first();
      if (await cookie.count()) await cookie.click({ timeout: 1500 });
    } catch { /* non-fatal */ }

    // 3b) guarantee the consent overlay is actually gone before we interact
    // with the panel. Under load / slow cold starts the .consent-scrim can
    // linger (or re-render) after the accept click and then intercepts pointer
    // events, swallowing the "Check today's price" click and failing the run.
    try {
      const scrim = page.locator('.consent-scrim').first();
      if (await scrim.count()) {
        await scrim.waitFor({ state: 'detached', timeout: 3000 }).catch(() => {});
      }
      // if it still lingers (stalled animation / re-render), remove it outright
      await page.evaluate(() => {
        document.querySelectorAll('.consent-scrim').forEach((el) => el.remove());
      });
    } catch { /* non-fatal */ }

    // 4) select the requested option (resets phase -> idle) ----------------
    if (optionLabel) {
      const chip = page
        .locator('button.opt-chip, .opt-picker button')
        .filter({ hasText: new RegExp(`^\\s*${escapeRe(optionLabel)}\\s*$`, 'i') })
        .first();
      if (!(await chip.count())) {
        // fall back to any button with the exact label
        const anyBtn = page.locator('button').filter({ hasText: new RegExp(`^\\s*${escapeRe(optionLabel)}\\s*$`, 'i') }).first();
        if (!(await anyBtn.count())) {
          throw new ScrapeError('option', `option "${optionLabel}" not found on page`, { retryable: false });
        }
        await anyBtn.click({ timeout: 4000 });
      } else {
        await chip.click({ timeout: 4000 });
      }
      // confirm selection
      try {
        await page.waitForFunction(
          (lbl) => {
            const re = new RegExp('^\\s*' + lbl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$', 'i');
            return [...document.querySelectorAll('button')].some(
              (b) => re.test((b.textContent || '').trim()) && b.getAttribute('aria-pressed') === 'true'
            );
          },
          optionLabel,
          { timeout: 4000 }
        );
      } catch {
        warnings.push('option-selected-unconfirmed');
      }
      await sleep(250);
    }

    // 5) satisfy the presence tracker: >=8 moves >=40ms apart, >=600ms dwell
    const panel = page.locator('.offer-panel').first();
    const box = await panel.boundingBox();
    if (!box) throw new ScrapeError('presence', 'offer panel has no bounding box', { retryable: true });

    // start from outside so mouseenter fires, then sweep inside the panel
    await page.mouse.move(Math.max(2, box.x - 60), Math.max(2, box.y - 60));
    await sleep(60);
    const sweep = async (n = 14) => {
      for (let k = 0; k < n; k++) {
        const x = box.x + 12 + ((k * 41) % Math.max(20, box.width - 24));
        const y = box.y + 10 + ((k * 29) % Math.max(16, box.height - 20));
        await page.mouse.move(x, y);
        await sleep(65); // >40ms throttle so each move is recorded
      }
    };
    await sweep(14);

    // 6) wait for the "Check today's price" button to enable, keep jiggling
    const checkBtn = page.locator('button', { hasText: /check today/i }).first();
    let enabled = false;
    for (let i = 0; i < 12 && !enabled; i++) {
      enabled = await checkBtn.isEnabled().catch(() => false);
      if (!enabled) { await sweep(4); }
    }
    if (!enabled) {
      throw new ScrapeError('locked', 'price stayed locked (presence not accepted)', { retryable: true });
    }

    // 7) click to trigger the decode/load (trusted click) -------------------
    await checkBtn.click({ timeout: 5000 });

    // 8) wait for terminal phase: ready (success) or failed -----------------
    let ready = false;
    try {
      await page.waitForSelector('.offer-panel.offer-ready, .offer-panel.offer-failed', {
        timeout: 25000,
        state: 'attached',
      });
      ready = await page.locator('.offer-panel.offer-ready').first().isVisible().catch(() => false);
    } catch {
      throw new ScrapeError('failed_phase', 'timed out waiting for price to load', { retryable: true });
    }
    if (!ready) {
      const msg = await page.locator('.offer-panel.offer-failed').first().innerText().catch(() => '');
      throw new ScrapeError('failed_phase', `store returned failure phase: ${cleanText(msg).slice(0, 160)}`, {
        retryable: true,
      });
    }

    // small settle so split spans / fonts are laid out
    await sleep(200);

    // 9) extract from the live DOM using the *current* manifest classes -----
    const data = await page.evaluate(() => {
      const isVisible = (el) => {
        if (!el) return false;
        if (el.getAttribute('aria-hidden') === 'true') return false;
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
        return el.getClientRects().length > 0;
      };
      const textOf = (el) => (el ? el.textContent : null);

      const panel = document.querySelector('.offer-panel.offer-ready');
      if (!panel) return { error: 'no-ready-panel' };

      // The page renders decoys: a hidden span.price-value and a hidden
      // span.amount[data-price]. The REAL price is the visible element carrying
      // the manifest priceValue class (a <strong>), so we target that and
      // explicitly reject aria-hidden / display:none nodes.
      const manifestPromise = fetch('/api/v2/ui/manifest').then((r) => r.json()).catch(() => null);
      return manifestPromise.then((manifest) => {
        const cls = (manifest && manifest.classes) || {};
        const priceTag = (manifest && manifest.priceTag) || 'strong';
        const priceCarrier = (manifest && manifest.priceCarrier) || null;

        const pickVisible = (sel) => {
          if (!sel) return null;
          const nodes = [...panel.querySelectorAll('.' + sel)];
          return nodes.find(isVisible) || null;
        };

        // price: manifest class first, then visible priceTag with digits
        let priceEl = pickVisible(cls.priceValue);
        if (!priceEl) {
          const tagEls = [...panel.querySelectorAll(priceTag)].filter(isVisible);
          priceEl = tagEls.find((e) => /\d/.test(e.textContent || '')) || null;
        }
        // explicit decoy guard
        if (priceEl && (priceEl.classList.contains('price-value') || priceEl.hasAttribute('data-price'))) {
          priceEl = null;
        }

        const stockEl = pickVisible(cls.stock) || panel.querySelector('.avail-pill');
        const pill = panel.querySelector('.avail-pill');

        const fpRoles = [
          document.querySelector('.offer-panel') ? 'offer-panel' : '',
          panel.querySelector('.offer-row') ? 'offer-row' : '',
          panel.querySelector('.offer-facts') ? 'offer-facts' : '',
          pill ? 'avail-pill' : '',
          priceTag,
          priceCarrier || '',
        ].filter(Boolean);

        return {
          manifestRevision: manifest && manifest.revision,
          priceValueClass: cls.priceValue || null,
          stockClass: cls.stock || null,
          priceText: textOf(priceEl),
          priceFound: !!priceEl,
          stockText: textOf(stockEl),
          stockFound: !!stockEl,
          pillClass: pill ? pill.className : null,
          mrpText: textOf(pickVisible(cls.mrp)),
          badgeText: textOf(pickVisible(cls.badge)),
          sellerText: textOf(pickVisible(cls.seller)),
          ratingText: textOf(pickVisible(cls.rating)),
          deliveryText: textOf(pickVisible(cls.delivery)),
          footText: textOf(panel.querySelector('.offer-foot span')),
          fingerprint: fpRoles.sort().join('~'),
        };
      });
    });

    if (!data || data.error) {
      throw new ScrapeError('extract', `extraction failed: ${data && data.error}`, { retryable: true });
    }

    // 10) validate + normalise ---------------------------------------------
    const price = normalizePrice(data.priceText);
    const stock = normalizeStock(data.stockText, data.pillClass);

    if (!data.priceFound || price.value === null) {
      throw new ScrapeError('validate', `could not read a valid price (raw="${cleanText(data.priceText)}")`, {
        retryable: true,
        detail: { priceText: data.priceText, fingerprint: data.fingerprint },
      });
    }
    if (!data.stockFound || stock.value === null) {
      throw new ScrapeError('validate', `could not read a valid stock (raw="${cleanText(data.stockText)}")`, {
        retryable: true,
        detail: { stockText: data.stockText, fingerprint: data.fingerprint },
      });
    }

    // sanity cross-check against the line-through MRP (catches decoy leakage)
    const mrp = data.mrpText ? normalizePrice(data.mrpText).value : null;
    if (mrp && price.value > mrp * 1.5) {
      warnings.push(`price(${price.value}) >> mrp(${mrp}) — possible misread`);
    }

    const pageAttempts = (() => {
      const m = cleanText(data.footText || '').match(/(\d+)\s*attempt/i);
      return m ? parseInt(m[1], 10) : null;
    })();

    return {
      price: price.value,
      stock: stock.value,
      inStock: stock.inStock === null ? stock.value > 0 : stock.inStock,
      mrp,
      badgePct: data.badgeText ? normalizeBadgePct(data.badgeText) : null,
      seller: cleanText(data.sellerText || '').replace(/^Seller:\s*/i, '') || null,
      rating: cleanText(data.ratingText || '') || null,
      delivery: cleanText(data.deliveryText || '') || null,
      rawPriceText: cleanText(data.priceText || ''),
      rawStockText: cleanText(data.stockText || ''),
      fingerprint: data.fingerprint,
      manifestRevision: data.manifestRevision,
      pageAttempts,
      quoteStatus: net.quoteStatus,
      handshakeCount: net.handshakeCount,
      warnings,
    };
  } finally {
    page.off('response', onResponse);
  }
}
