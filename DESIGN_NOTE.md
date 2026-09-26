# Design Note — INE Product Price Tracker

How the scraping was made reliable, the trade-offs taken, and an honest account
of what the AI tooling got wrong on the first attempt and how it was corrected.

---

## 1. Understanding the target before writing the scraper

The store (`https://demo.inelabteamdev.com`) is a Vite/React SPA: the HTML shell is
empty and everything is rendered client-side. Inspecting the JS bundle revealed
three clean JSON endpoints and one deliberately hostile path:

| Endpoint | Contents | Scraping approach |
|---|---|---|
| `GET /api/v2/listings?page&limit` | catalog (id, slug, name, brand, category, sku). **Ignores all search params**; caps `perPage` at 60 (960 items / 16 pages). | Lightweight HTTP + paginate + filter in-app |
| `GET /api/v2/items/{id}` | metadata, specs, `optionAxis`, `options[{id,label}]`. **No price/stock.** | Lightweight HTTP |
| `GET /api/v2/ui/manifest` | rotating CSS class names (`priceValue`, `stock`, …), `priceTag`, `priceCarrier`, `revision`, `validUntil` | Lightweight HTTP, read fresh each scrape |
| `GET /api/v2/items/{id}/quote?opt={opt}` + `/api/v2/handshake` | the price/stock payload — **XOR + WebAssembly-decoded in page JS**, gated behind a trusted-presence handshake | Headless Chromium only |

The product page (`/item/{id}`) is the hard part. Its offer panel:

- starts `offer-locked` ("Price locked — hover over the price area…") with a
  **disabled** "Check today's price" button;
- only enables that button once a presence tracker has seen **≥8 real `mousemove`
  events ≥40 ms apart** and **≥600 ms dwell** inside the panel;
- on a **trusted** click, calls `/api/v2/handshake` + `/quote?opt=…`, decodes the
  response with WASM+XOR (using the presence snapshot), retries internally up to
  6 times, then renders `offer-ready`;
- renders the price split **per-character with zero-width spaces**, in rotating
  format variants (plain `₹5,345`, spaced `₹87 556`, lakh `₹1,45,654`,
  `Rs. …`, `…/- (incl. of all taxes)`, fullwidth digits, NBSP injection);
- plants **hidden decoy nodes**: `<span class="price-value" aria-hidden style="display:none">₹4,926</span>`
  and `<span class="amount" data-price="true" aria-hidden style="display:none">₹5,641</span>`;
- renders stock via 5 rotating templates ("N units available", "Last few: N",
  "Available (N)", "Stock: N remaining", "Ready to ship · N available").

---

## 2. The core judgment call: lightweight HTTP vs headless browser

**Decision: hybrid.** Lightweight HTTP (`fetch`) for search, product metadata and
the manifest — these are clean JSON and need no browser. Headless Chromium
(Playwright) **only** for price/stock.

Why a browser is genuinely required for price/stock (the assignment's exact
criterion for reaching for one):

1. The quote is gated behind a **trusted-event presence handshake** — synthetic
   `dispatchEvent` calls do not satisfy it (verified: the button stayed disabled).
2. The payload is **WASM + XOR decoded in page JS**; replicating that in Node would
   mean reverse-engineering an obfuscated string table and a rotating key — brittle
   and against the spirit of the task.
3. The rendered values use **rotating class names and format variants**, so the
   stable, correct signal is *what a human sees*: the visible price element.

So the scraper lets the page do its own decode and reads the **visible** result.
Everything else stays on cheap, fast HTTP. This keeps Chromium's cost confined to
the one thing that truly needs it.

---

## 3. Reliability mechanisms

- **Retries + exponential backoff + full jitter** at two levels: the HTTP layer
  (network errors, timeouts, 429/5xx) and the whole-page layer (nav failure,
  presence not accepted, `offer-failed`, extraction/validation miss).
- **Fresh page per attempt** — a polluted or half-loaded page never leaks into the
  next try; contexts are closed in a `finally`.
- **Presence simulation** that exceeds the thresholds (14 moves, ~65 ms apart,
  sweep inside the panel) and re-sweeps while waiting for the button to enable.
- **Explicit terminal-state wait**: `offer-ready` (success) vs `offer-failed`
  (store-side failure) vs timeout — never assume success.
- **Decoy-proof extraction**: target the element carrying the manifest's *current*
  `priceValue` class, require it to be visible (not `aria-hidden`, not
  `display:none`), and explicitly reject the `.price-value` / `[data-price]` traps.
  Fallback: the visible `priceTag` (`<strong>`) containing digits.
- **Normalisation**: strip ZWSP/NBSP/zero-width chars, fold fullwidth digits, drop
  currency letters and trailing prose, then parse with a separator heuristic that
  handles Indian and European grouping and 0–2 decimals.
- **Validation before storing**: a `price_history` row is written **only** when a
  positive price and a non-negative integer stock are parsed. Anything else raises
  a retryable `validate` error; if all attempts fail, the run is logged `failed`
  with **empty** price/stock and no history row. Wrong data is never stored.
- **Sanity cross-check**: warn (don't fail) if price ≫ MRP, which would indicate a
  decoy leak.
- **Change detection**: a DOM structural fingerprint (which roles exist +
  `priceTag` + `priceCarrier`, independent of the rotating class strings) is stored
  per product; drift raises a `structure_changed` alert and is flagged on the log
  row, instead of silently storing garbage.
- **Honest outcomes**: `success` (first try) / `retried` (succeeded after ≥1 retry)
  / `failed` (no data). The attempt count, latency, raw text, and any error are all
  persisted so the history is auditable.
- **Resource blocking**: images/media/fonts are aborted in the browser context to
  cut load time and flakiness; JS/XHR/document are kept so the handshake + decode run.
- **Free-tier friendliness**: `SCRAPE_CONCURRENCY=1`, browser closed after each
  scheduled pass, Chromium shipped via a Docker image so Render has the system libs.

---

## 4. Trade-offs

| Trade-off | Choice | Why |
|---|---|---|
| Browser vs HTTP for price | Browser (price/stock only) | handshake + WASM decode are not replicable over HTTP; everything else stays HTTP |
| Read rendered text vs decode quote JSON | Rendered visible text | stable against WASM/XOR + rotating keys; validated against MRP×(1−badge%) |
| Chromium memory on Render free tier | concurrency 1, block media, close browser per run | 512 MB headroom; correctness over throughput |
| Store raw text alongside parsed values | Yes (`raw_price_text`, `raw_stock_text`) | auditability — proves what the DOM actually showed |
| Outcome granularity | success/retried/failed per run (+ attempts) | matches the assignment's CSV/log contract; retries are visible, not hidden |
| Search filtering | In-app over a cached full catalog | the store ignores query params; caching 960 items makes search instant |
| Scheduling | External cron (cron-job.org) | free-tier backends sleep; an always-on loop would be killed |
| Email alerts | Optional SendGrid, off by default | bonus feature; in-app alerts always on |

---

## 5. What the AI tooling got wrong on the first attempt (and the corrections)

1. **Naive price selectors.** The first extraction attempt targeted
   `[data-price]` and `.price-value` — the two most "obvious" hooks. Both are
   **hidden decoys** (`₹5,641`, `₹4,926`). *Correction:* read the rendered DOM,
   discovered the real price is the visible `<strong>` with the manifest
   `priceValue` class, and added explicit decoy rejection + a MRP×(1−badge%)
   cross-check.
2. **Assumed HTTP-only would work / synthetic events would unlock the price.**
   Early prototypes tried `fetch` of the quote and `dispatchEvent(new MouseEvent(...))`
   to trigger the load. Neither worked: the unlock needs **trusted** events and the
   quote needs a WASM/XOR decode. *Correction:* switched to genuine Playwright
   mouse movement + a trusted click, and confined the browser to price/stock only.
3. **Unstable Chromium flags.** To save memory the first launch used
   `--single-process --no-zygote`. This made Chromium tear down when the first
   context closed, so multi-product runs died after one item. *Correction:* removed
   those flags and added a `disconnected` handler that relaunches on demand.
4. **Assumed the listings API supports search.** `?q=`, `?search=`, `?name=` are all
   silently ignored (the API always returns the full 960). *Correction:* paginate
   all 16 pages, cache, and filter/score in-app by name/brand/category/sku.
5. **Assumed a simple price format.** The first normaliser handled only `₹N,NNN`.
   Live runs showed spaced (`₹87 556`) and lakh (`₹1,45,654`) variants and
   per-character zero-width splitting. *Correction:* wrote a normaliser covering all
   `Ir()` variants (spaced/euro/trailing/unicode/nbsp/lakh) plus fullwidth folding.
6. **Over-trusted the first hover.** A single `mouse.move` to the panel centre did
   not unlock the price (needs ≥8 moves + 600 ms dwell). *Correction:* a multi-move
   sweep with >40 ms spacing and a dwell, re-swept while polling for enablement.

---

## 6. AI usage disclosure

AI assistance was used to (a) explore and summarise the store's JS bundle and
endpoints, (b) draft the normalisation, retry, and Playwright interaction logic,
and (c) scaffold Express/React boilerplate and this documentation. All scraping
behaviour was **verified against the live mock store** with `src/scraper/probe.js`
and repeated headless runs (including observed retries on genuinely slow/failed
quotes), and the decoy/format-variant findings above were confirmed empirically
rather than accepted from generated code. The architecture decisions, the
HTTP-vs-browser boundary, and the honesty guarantees (never store bad data; log
failures) are deliberate engineering choices validated by test runs.
