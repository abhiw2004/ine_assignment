# INE Product Price Tracker (Web Scraping)

A full-stack web app that searches INE's hosted mock store
(<https://demo.inelabteamdev.com>), lets a user pick a product **and** one of its
options, then tracks that option's **price** and **stock** over time by scraping
the store on a schedule. Shows price/stock history as a chart + table, an honest
per-product scrape log, and exports the full scrape history as CSV.

- **Frontend:** React 18 + Vite (+ Recharts) — deployed on **Vercel**
- **Backend:** Node.js + Express — deployed on **Render** (Docker image with Chromium)
- **Database:** **Supabase (PostgreSQL)**
- **Scraping:** lightweight HTTP (fetch) for search/metadata + **Playwright (headless Chromium)** for price/stock
- **Scheduling:** external cron (**cron-job.org**) → `POST /api/scrape/run` every 2 hours

---

## Repository layout

```
.
├── backend/                 # Express API + scraper + cron job
│   ├── db/schema.sql        # Supabase (Postgres) schema — run this first
│   ├── src/
│   │   ├── server.js        # Express app
│   │   ├── config.js        # env-driven config
│   │   ├── store/catalog.js # lightweight-HTTP layer (listings/items/manifest)
│   │   ├── scraper/
│   │   │   ├── browser.js   # Playwright lifecycle (headless/headed)
│   │   │   ├── extract.js   # presence handshake → unlock → read visible price/stock
│   │   │   ├── normalize.js # defeats ZWSP / fullwidth / format-variant obfuscation
│   │   │   ├── manifest.js  # rotating CSS class names (change detection)
│   │   │   ├── index.js     # retries + outcome classification
│   │   │   └── probe.js     # investigation/verification tool
│   │   ├── services/        # scrapeService, alertService, csv
│   │   ├── db/              # supabase client + repositories
│   │   ├── routes/          # catalog, tracked, export, scrape(cron), alerts, health
│   │   └── jobs/runScrape.js# CLI: scheduled pass / ad-hoc / loop / headed
│   ├── Dockerfile           # Chromium-enabled image for Render
│   └── render.yaml          # Render blueprint
└── frontend/                # React dashboard
    ├── src/
    │   ├── App.jsx          # dashboard shell
    │   └── components/      # SearchPanel, ProductCard, ProductDetail, PriceChart, AlertsPanel
    └── vercel.json          # SPA rewrite for Vercel
```

---

## 1. Database setup (Supabase)

1. Create a free Supabase project.
2. Open **SQL Editor** → paste and run [`backend/db/schema.sql`](backend/db/schema.sql).
   This creates `tracked_products`, `price_history`, `scrape_logs`, `alerts`,
   `catalog_cache`, indexes, an `updated_at` trigger, and read-only RLS policies
   (writes go through the backend's service-role key).
3. Copy your keys from **Project Settings → API**:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY` (backend only — never expose in the frontend)
   - `SUPABASE_ANON_KEY` (optional; frontend reads via the backend, so not strictly needed)

---

## 2. Backend setup (local)

```bash
cd backend
npm install            # also installs Chromium via Playwright postinstall
cp .env.example .env   # then fill in the values below
npm run dev            # http://localhost:8080
```

### Environment variables (backend)

| Variable | Required | Purpose |
|---|---|---|
| `PORT` | no (8080) | HTTP port |
| `STORE_BASE_URL` | no | Target store (default `https://demo.inelabteamdev.com`) |
| `SUPABASE_URL` | **yes** | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | **yes** | Service-role key (bypasses RLS for writes) |
| `SUPABASE_ANON_KEY` | no | Anon key (unused by backend writes) |
| `CRON_SECRET` | **yes (prod)** | Shared secret for `POST /api/scrape/run` (`x-cron-secret` header) |
| `CORS_ORIGIN` | no (`*`) | Comma-separated allowed frontend origins |
| `SCRAPE_HEADED` | no (`false`) | `true` = headed/observable Chromium run |
| `SCRAPE_SLOW_MO` | no (`0`) | ms between Playwright actions (nice for recordings) |
| `SCRAPE_RETRIES` | no (`4`) | attempts per product per run |
| `SCRAPE_CONCURRENCY` | no (`1`) | keep `1` on Render free tier (RAM) |
| `SCRAPE_TIMEOUT_MS` / `NAV_TIMEOUT_MS` / `HTTP_TIMEOUT_MS` | no | timeouts |
| `HTTP_RETRIES` | no (`4`) | retries for the lightweight-HTTP layer |
| `DEFAULT_INTERVAL_MIN` | no (`120`) | default per-product schedule (2h) |
| `ALERTS_ENABLED` | no (`true`) | price-drop / back-in-stock alerts |
| `PRICE_DROP_PCT` | no (`0`) | alert threshold; `0` = any drop |
| `SENDGRID_API_KEY` / `ALERT_EMAIL_TO` / `ALERT_EMAIL_FROM` | no | optional email alerts |
| `CATALOG_TTL_MS` | no | catalog cache TTL |
| `USER_AGENT` | no | UA sent to the store |

---

## 3. Frontend setup (local)

```bash
cd frontend
npm install
npm run dev            # http://localhost:5173  (proxies /api -> :8080)
```

For production set `VITE_API_URL` to your Render backend origin (see
`frontend/.env.example`). In local dev it can be empty because Vite proxies `/api`.

---

## 4. Scraping schedule (external cron)

Free-tier backends sleep, so the schedule is driven by an **external cron** rather
than an always-on loop.

**cron-job.org configuration**

| Field | Value |
|---|---|
| URL | `https://<your-backend>.onrender.com/api/scrape/run` |
| Method | `POST` |
| Schedule | every **2 hours** (e.g. `0 */2 * * *`) |
| Header | `x-cron-secret: <CRON_SECRET>` |
| Body (JSON, optional) | `{}` (or `{"force":true}` to ignore due-checks) |

Each pass scrapes every **active + due** tracked product (respecting each
product's own `scrape_interval_min`), writes one `scrape_logs` row per run
(`success` / `retried` / `failed`) and, only on success, a `price_history` row.

**Alternatives**

- Manual / local: `npm run scrape` (one pass) or `npm run scrape -- --force`.
- Ad-hoc, no DB: `node src/jobs/runScrape.js --adhoc --id 2457 --option "Single"`.
- Local always-on loop (dev only): `npm run scrape -- --loop --interval-min 120`.
- Render cron job (paid) or a scheduled function can also hit the same endpoint.

**Keeping the instance warm:** cron-job.org's 2-hourly `POST /api/scrape/run`
wakes the sleeping instance. Optionally add a second lightweight cron hitting
`GET /health` every ~10 minutes.

---

## 5. Observable (headed) run

To watch the scraper behave in a real browser window:

```bash
cd backend
SCRAPE_HEADED=true SCRAPE_SLOW_MO=120 node src/jobs/runScrape.js --adhoc
# or: npm run scrape:headed
```

This opens Chromium visibly and drives a few products end-to-end: it dismisses
the cookie banner, selects the option chip, performs the trusted mouse-presence
sweep that unlocks the price, clicks "Check today's price", waits for the async
quote, and reads the rendered price/stock. Because the store is deliberately
flaky, a headed run over 2–3 products will usually show at least one slow/failed
quote being **retried** (the log line prints `attempt N failed … retrying` and the
final outcome is recorded as `retried`). Record this for the submission video.

`src/scraper/probe.js` is a lower-level investigation tool that dumps the rendered
offer-panel DOM, the manifest, and the network calls (`/api/v2/handshake`,
`/api/v2/items/{id}/quote?opt=…`) — useful for verifying extraction.

---

## 6. How the scraping is made reliable (summary)

See [`DESIGN_NOTE.md`](DESIGN_NOTE.md) for the full write-up. In short:

1. **Two-tier fetching.** Lightweight HTTP (`fetch`) for everything that is clean
   JSON — catalog search (`/api/v2/listings`), product metadata + options
   (`/api/v2/items/{id}`), and the UI manifest. Headless Chromium **only** for
   price/stock, because the quote is gated behind a trusted-presence handshake and
   a WASM/XOR decode and is rendered with rotating class names, per-character
   zero-width splitting, and hidden decoy prices.
2. **Presence handshake.** The page only reveals the price after ≥8 real
   `mousemove` events (≥40 ms apart) plus ≥600 ms dwell inside the price panel;
   the scraper reproduces this with genuine Playwright mouse moves, then performs
   a trusted click on "Check today's price".
3. **Decoy-proof extraction.** Reads the *visible* element carrying the manifest's
   current `priceValue` class (a `<strong>`), explicitly rejecting `aria-hidden` /
   `display:none` nodes and the literal `.price-value` / `[data-price]` traps.
4. **Text normalisation.** Strips zero-width spaces / NBSP, folds fullwidth digits,
   and parses every rotating format variant (`₹5,345`, `₹87 556`, `₹1,45,654`,
   `Rs. …`, `…/- (incl. of all taxes)`, European grouping).
5. **Retries + backoff + jitter** at both the HTTP layer and the whole-page layer;
   each attempt uses a **fresh page** so polluted state never leaks.
6. **Honest outcomes.** `success` (first try) / `retried` (succeeded after retries)
   / `failed` (no data). Failures are logged with empty price/stock and **never**
   write a `price_history` row.
7. **Change detection.** A DOM structural fingerprint is stored per product; drift
   raises a `structure_changed` alert instead of silently storing garbage.

---

## 7. API reference

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | liveness + db status |
| GET | `/api/catalog/search?q=&limit=` | search store by partial/full name |
| GET | `/api/catalog/item/:id` | product metadata incl. options + specs |
| GET | `/api/tracked` | list tracked products |
| POST | `/api/tracked` | start tracking `{storeProductId, optionId, scrapeIntervalMin?, scrapeNow?}` |
| GET | `/api/tracked/:id` | tracked row + price history + scrape log |
| PATCH | `/api/tracked/:id` | update `{scrapeIntervalMin?, active?}` |
| DELETE | `/api/tracked/:id` | stop tracking |
| POST | `/api/tracked/:id/scrape` | manual "run now" |
| GET | `/api/export.csv` | full scrape history CSV (one row per attempt) |
| POST | `/api/scrape/run` | **cron entry point** (header `x-cron-secret`) |
| GET | `/api/scrape/config` | non-secret scheduling info |
| GET | `/api/alerts` | recent price/stock/structure alerts |

### CSV columns

`product_id, product_name, option, timestamp_utc, price, stock, outcome`
(one row per scrape attempt; failed rows included with empty `price`/`stock`).

---

## 8. Deployment

- **Backend → Render:** use `backend/render.yaml` (Docker runtime) or create a Web
  Service from `backend/Dockerfile`. Set the env vars above. Note the free tier
  sleeps; the 2-hourly cron wakes it.
- **Frontend → Vercel:** import `frontend/`, framework = Vite, set
  `VITE_API_URL=https://<your-backend>.onrender.com`. `vercel.json` handles SPA
  rewrites.
- **Cron → cron-job.org:** as in §4.

---

## 9. AI usage disclosure

AI tooling was used to explore the store's bundle, draft the normalisation and
retry logic, and scaffold boilerplate. Every scraping decision was validated
against the live store with the included `probe.js` and repeated headless runs;
see `DESIGN_NOTE.md` for what the AI got wrong initially and how it was corrected.
