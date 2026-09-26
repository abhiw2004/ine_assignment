import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import SearchPanel from './components/SearchPanel.jsx';
import ProductCard from './components/ProductCard.jsx';
import ProductDetail from './components/ProductDetail.jsx';
import AlertsPanel from './components/AlertsPanel.jsx';

function Toast({ toast }) {
  if (!toast) return null;
  return <div className={`toast ${toast.type || ''}`}>{toast.msg}</div>;
}

export default function App() {
  const [tracked, setTracked] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [cfg, setCfg] = useState(null);
  const [dbOk, setDbOk] = useState(null);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState(null);
  const [runningId, setRunningId] = useState(null);
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);

  const notify = useCallback((msg, type = '') => {
    setToast({ msg, type });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4200);
  }, []);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [tr, al, hc] = await Promise.all([
        api.listTracked().catch((e) => { throw e; }),
        api.alerts(40).catch(() => ({ results: [] })),
        api.health().catch(() => null),
      ]);
      setTracked(tr.results || []);
      setAlerts(al.results || []);
      setDbOk(hc ? !!hc.db : null);
    } catch (e) {
      if (!silent) notify(`Could not reach backend: ${e.message}`, 'err');
      setDbOk(false);
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    load();
    api.scrapeConfig().then(setCfg).catch(() => {});
    const iv = setInterval(() => load(true), 30000); // reflect unattended runs
    return () => clearInterval(iv);
  }, [load]);

  async function runNow(t) {
    setRunningId(t.id);
    try {
      const r = await api.scrapeNow(t.id);
      notify(`"${t.name}" → ${r.outcome}${r.price != null ? ` · ₹${Number(r.price).toLocaleString('en-IN')} · stock ${r.stock}` : (r.error ? ` · ${r.error}` : '')}`, r.outcome === 'failed' ? 'err' : 'ok');
      await load(true);
    } catch (e) {
      notify(`Run failed: ${e.message}`, 'err');
    } finally {
      setRunningId(null);
    }
  }

  async function remove(t) {
    if (!confirm(`Stop tracking "${t.name}" (${t.option_label}) and delete its history?`)) return;
    try {
      await api.deleteTracked(t.id);
      notify('Removed', 'ok');
      await load(true);
    } catch (e) { notify(`Delete failed: ${e.message}`, 'err'); }
  }

  function exportCsv() {
    // direct browser download from the backend CSV endpoint
    window.open(api.exportCsvUrl(), '_blank');
    notify('Downloading scrape history CSV…', 'ok');
  }

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <div className="logo">📈</div>
          <div>
            <h1>INE Product Price Tracker</h1>
            <p>
              Scrapes price &amp; stock from{' '}
              <a href={cfg?.storeBaseUrl || 'https://demo.inelabteamdev.com'} target="_blank" rel="noreferrer">INE&apos;s mock store</a>
              {' '}every {cfg ? `${cfg.defaultIntervalMin}m` : '2h'} via external cron
              {dbOk === false && <span className="badge failed" style={{ marginLeft: 8 }}>db not configured</span>}
            </p>
          </div>
        </div>
        <div className="header-actions">
          <button className="btn" onClick={() => load()} disabled={loading}>{loading ? <span className="spinner" /> : '↻'} Refresh</button>
          <button className="btn primary" onClick={exportCsv}>⬇ Export CSV</button>
        </div>
      </header>

      <div className="grid" style={{ marginBottom: 18 }}>
        <SearchPanel onTracked={() => load(true)} notify={notify} />
      </div>

      <div className="grid cols-2" style={{ gridTemplateColumns: '1.6fr 1fr', alignItems: 'start' }}>
        <div className="card">
          <div className="section-title">
            <div>
              <h2>Tracked products</h2>
              <p className="sub" style={{ margin: 0 }}>
                {tracked.length} tracking · price history &amp; scrape log reflect real unattended runs
              </p>
            </div>
            <span className="badge info">{tracked.length}</span>
          </div>

          {loading && !tracked.length ? (
            <div className="empty"><span className="spinner" /> Loading…</div>
          ) : tracked.length === 0 ? (
            <div className="empty">
              Nothing tracked yet. Search above and pick a product + option to start tracking.<br />
              <span className="muted small">Tip: track 2–3 products so the dashboard shows real history by submission.</span>
            </div>
          ) : (
            <div className="tracked-grid">
              {tracked.map((t) => (
                <ProductCard
                  key={t.id}
                  t={t}
                  running={runningId === t.id}
                  onOpen={(x) => setOpenId(x.id)}
                  onRun={runNow}
                  onDelete={remove}
                />
              ))}
            </div>
          )}
        </div>

        <div className="grid" style={{ gap: 18 }}>
          <AlertsPanel alerts={alerts} />
          <div className="card">
            <h2>How scraping works</h2>
            <p className="sub">Reliability notes for this build</p>
            <ul className="muted small" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
              <li><b>Lightweight HTTP</b> for search &amp; product metadata (clean JSON APIs).</li>
              <li><b>Headless Chromium</b> only for price/stock — the quote is gated behind a trusted-presence handshake and a WASM/XOR decode, then rendered with rotating CSS classes, per-character zero-width splitting and hidden decoy prices.</li>
              <li><b>Retries + backoff</b> on slow/failed loads; every run is logged honestly as <span className="badge success">success</span> <span className="badge retried">retried</span> or <span className="badge failed">failed</span>.</li>
              <li><b>Never stores bad data</b>: a price row is written only when a valid price+stock is read; failures are logged with empty price/stock.</li>
              <li><b>Structure-change detection</b> flags when the page shape drifts.</li>
            </ul>
          </div>
        </div>
      </div>

      <div className="footer">
        Backend: Node/Express · Frontend: React/Vite · DB: Supabase (Postgres) · Scheduling: cron-job.org → <span className="mono">POST /api/scrape/run</span>
      </div>

      {openId && (
        <ProductDetail
          trackedId={openId}
          onClose={() => setOpenId(null)}
          onChanged={() => load(true)}
          notify={notify}
        />
      )}
      <Toast toast={toast} />
    </div>
  );
}
