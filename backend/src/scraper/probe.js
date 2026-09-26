// Investigation probe: render a product page with a real browser, trigger the
// interaction-gated async price load, and dump the resulting DOM so we can
// design robust extraction. Run: node src/scraper/probe.js [id] [optionLabel]
import { chromium } from 'playwright';

const BASE = 'https://demo.inelabteamdev.com';
const id = process.argv[2] || '2457';
const optionLabel = process.argv[3] || null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  const requests = [];
  page.on('request', (r) => requests.push(r.url()));

  console.log('== navigating ==');
  await page.goto(`${BASE}/item/${id}`, { waitUntil: 'domcontentloaded', timeout: 45000 });

  // manifest (drives rotating class names)
  const manifest = await page.evaluate(async () => {
    const r = await fetch('/api/v2/ui/manifest');
    return r.json();
  });
  console.log('MANIFEST', JSON.stringify(manifest, null, 2));

  // dismiss cookie banner if present
  const cookieBtn = page.locator('button', { hasText: /allow cookies/i }).first();
  if (await cookieBtn.count()) {
    try { await cookieBtn.click({ timeout: 2000 }); console.log('clicked allow cookies'); } catch {}
  }

  // list option buttons
  const optionButtons = page.locator('.offer-panel ~ * button, main button').filter({ hasText: /.+/ });
  const opts = await page.evaluate(() => {
    return [...document.querySelectorAll('button')].map((b) => ({
      text: (b.textContent || '').trim(),
      pressed: b.getAttribute('aria-pressed'),
      disabled: b.disabled,
    }));
  });
  console.log('BUTTONS', JSON.stringify(opts, null, 2));

  // select option if requested
  if (optionLabel) {
    const btn = page.locator('button', { hasText: new RegExp(`^${optionLabel}$`, 'i') }).first();
    if (await btn.count()) { await btn.click(); console.log('selected option', optionLabel); await sleep(500); }
  }

  // Satisfy the presence tracker: >=8 mousemove events >=40ms apart + >=600ms dwell.
  const panel = page.locator('.offer-panel').first();
  const box = await panel.boundingBox();
  console.log('PANEL BOX', box);
  const hover = async () => {
    if (!box) return;
    for (let k = 0; k < 14; k++) {
      const x = box.x + 20 + ((k * 37) % Math.max(10, box.width - 40));
      const y = box.y + 15 + ((k * 23) % Math.max(10, box.height - 30));
      await page.mouse.move(x, y);
      await sleep(70);
    }
  };
  await hover();
  for (let i = 0; i < 12; i++) {
    const state = await page.evaluate(() => {
      const p = document.querySelector('.offer-panel');
      const btn = [...document.querySelectorAll('button')].find((b) => /check today/i.test(b.textContent || ''));
      return { cls: p ? p.className : null, btnDisabled: btn ? btn.disabled : null, sub: p ? (p.querySelector('.offer-submsg')?.textContent || null) : null };
    });
    console.log(`poll ${i}`, JSON.stringify(state));
    if (state.cls && /offer-ready/.test(state.cls)) break;
    if (state.btnDisabled === false) {
      const btn = page.locator('button', { hasText: /check today/i }).first();
      try { await btn.click({ timeout: 1500 }); console.log('clicked check price'); } catch (e) { console.log('click err', e.message); }
    } else {
      await hover();
    }
    await sleep(600);
  }

  await sleep(2000);

  const dump = await page.evaluate((m) => {
    const p = document.querySelector('.offer-panel');
    const cls = m.classes || {};
    const q = (c) => (c ? document.querySelector('.' + c) : null);
    const priceEl = q(cls.priceValue);
    const stockEl = q(cls.stock);
    const dp = document.querySelector('[data-price]');
    return {
      panelClass: p ? p.className : null,
      panelText: p ? p.innerText : null,
      panelHTML: p ? p.innerHTML.slice(0, 1500) : null,
      priceValueText: priceEl ? priceEl.innerText : null,
      priceValueHTML: priceEl ? priceEl.innerHTML : null,
      stockText: stockEl ? stockEl.innerText : null,
      dataPrice: dp ? dp.getAttribute('data-price') : null,
      dataPriceOuter: dp ? dp.outerHTML.slice(0, 400) : null,
    };
  }, manifest);
  console.log('DUMP', JSON.stringify(dump, null, 2));

  console.log('NETWORK (api only)', requests.filter((u) => /\/api\//.test(u)));

  await browser.close();
}

main().catch((e) => { console.error('PROBE ERROR', e); process.exit(1); });
