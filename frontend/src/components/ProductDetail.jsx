import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { inr, num, utc, ago, outcomeClass } from '../util/format.js';
import PriceChart from './PriceChart.jsx';

/** Detail modal: price/stock chart, history table, honest scrape log, settings. */
export default function ProductDetail({ trackedId, onClose, onChanged, notify }) {
  const [data, setData] = useState(null);
  const [tab, setTab] = useState('overview');
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [intervalMin, setIntervalMin] = useState(120);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api.trackedDetail(trackedId);
      setData(d);
      setIntervalMin(d.tracked.scrape_interval_min);
    } catch (e) {
      notify(`Load failed: ${e.message}`, 'err');
    } finally {
      setLoading(false);
    }
  }, [trackedId]);

  useEffect(() => { load(); }, [load]);

  async function runNow() {
    setRunning(true);
    try {
      const r = await api.scrapeNow(trackedId);
      notify(`Scrape ${r.outcome} — ${r.price != null ? inr(r.price) + ', stock ' + num(r.stock) : (r.error || 'no data')}`, r.outcome === 'failed' ? 'err' : 'ok');
      await load();
      onChanged && onChanged();
    } catch (e) {
      notify(`Run failed: ${e.message}`, 'err');
    } finally {
      setRunning(false);
    }
  }

  async function saveSettings() {
    try {
      await api.updateTracked(trackedId, { scrapeIntervalMin: intervalMin });
      notify('Schedule updated', 'ok');
      await load(); onChanged && onChanged();
    } catch (e) { notify(`Update failed: ${e.message}`, 'err'); }
  }

  async function remove() {
    if (!confirm('Stop tracking this product and delete its history?')) return;
    try {
      await api.deleteTracked(trackedId);
      notify('Removed', 'ok');
      onClose(); onChanged && onChanged();
    } catch (e) { notify(`Delete failed: ${e.message}`, 'err'); }
  }

  const t = data?.tracked;
  const history = data?.history || [];
  const logs = data?.logs || [];

  const prices = history.map((h) => Number(h.price)).filter(Number.isFinite);
  const stats = {
    min: prices.length ? Math.min(...prices) : null,
    max: prices.length ? Math.max(...prices) : null,
    scrapes: logs.length,
    failures: logs.filter((l) => l.outcome === 'failed').length,
    retries: logs.filter((l) => l.outcome === 'retried').length,
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 800 }}>{t ? t.name : 'Loading…'}</div>
            {t && (
              <div className="muted small">
                {t.option_axis ? `${t.option_axis}: ` : ''}{t.option_label} · id {t.store_product_id} ·{' '}
                <a href={t.url} target="_blank" rel="noreferrer">store page ↗</a>
              </div>
            )}
          </div>
          <div className="row">
            <button className="btn sm" onClick={load} disabled={loading}>{loading ? <span className="spinner" /> : '↻'}</button>
            <button className="close-x" onClick={onClose} aria-label="close">×</button>
          </div>
        </div>

        <div className="modal-body">
          {t && (
            <div className="stat-row">
              <div className="stat"><div className="label">Current price</div><div className="value">{t.last_price != null ? inr(t.last_price) : '—'}</div></div>
              <div className="stat"><div className="label">Stock</div><div className="value">{t.last_stock != null ? num(t.last_stock) : '—'}</div></div>
              <div className="stat"><div className="label">Last outcome</div><div className="value" style={{ fontSize: 15 }}>{t.last_outcome ? <span className={`badge ${outcomeClass(t.last_outcome)}`}>{t.last_outcome}</span> : '—'}</div></div>
              <div className="stat"><div className="label">Range (min–max)</div><div className="value" style={{ fontSize: 15 }}>{stats.min != null ? `${inr(stats.min)} – ${inr(stats.max)}` : '—'}</div></div>
              <div className="stat"><div className="label">Scrapes</div><div className="value">{stats.scrapes}<span className="muted small"> ({stats.failures} failed, {stats.retries} retried)</span></div></div>
            </div>
          )}

          <div className="tabs">
            <button className={`tab ${tab === 'overview' ? 'on' : ''}`} onClick={() => setTab('overview')}>Chart</button>
            <button className={`tab ${tab === 'history' ? 'on' : ''}`} onClick={() => setTab('history')}>Price history ({history.length})</button>
            <button className={`tab ${tab === 'log' ? 'on' : ''}`} onClick={() => setTab('log')}>Scrape log ({logs.length})</button>
            <button className={`tab ${tab === 'settings' ? 'on' : ''}`} onClick={() => setTab('settings')}>Settings</button>
          </div>

          {tab === 'overview' && <PriceChart history={history} logs={logs} />}

          {tab === 'history' && (
            history.length ? (
              <div className="table-wrap">
                <table>
                  <thead><tr>
                    <th>Timestamp (UTC)</th><th className="num">Price</th><th className="num">Stock</th>
                    <th>In stock</th><th className="num">MRP</th><th>Badge</th><th>Seller</th><th>Rating</th><th>Delivery</th>
                  </tr></thead>
                  <tbody>
                    {[...history].reverse().map((h) => (
                      <tr key={h.id}>
                        <td className="mono">{utc(h.scraped_at)}</td>
                        <td className="num"><b>{inr(h.price)}</b></td>
                        <td className="num">{num(h.stock)}</td>
                        <td>{h.in_stock ? <span className="pill-stock in">yes</span> : <span className="pill-stock out">no</span>}</td>
                        <td className="num muted">{h.mrp != null ? inr(h.mrp) : '—'}</td>
                        <td>{h.badge_pct != null ? `${h.badge_pct}%` : '—'}</td>
                        <td className="muted">{h.seller || '—'}</td>
                        <td className="muted">{h.rating || '—'}</td>
                        <td className="muted">{h.delivery || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <div className="empty">No history yet.</div>
          )}

          {tab === 'log' && (
            logs.length ? (
              <div className="table-wrap">
                <table>
                  <thead><tr>
                    <th>Timestamp (UTC)</th><th>Outcome</th><th className="num">Attempts</th>
                    <th className="num">Price</th><th className="num">Stock</th><th className="num">Latency</th>
                    <th>Mode</th><th>Structure</th><th>Error / notes</th>
                  </tr></thead>
                  <tbody>
                    {logs.map((l) => (
                      <tr key={l.id}>
                        <td className="mono">{utc(l.created_at)}</td>
                        <td><span className={`badge ${outcomeClass(l.outcome)}`}>{l.outcome}</span></td>
                        <td className="num">{l.attempts}</td>
                        <td className="num">{l.price != null ? inr(l.price) : <span className="muted">—</span>}</td>
                        <td className="num">{l.stock != null ? num(l.stock) : <span className="muted">—</span>}</td>
                        <td className="num muted">{l.latency_ms != null ? `${l.latency_ms}ms` : '—'}</td>
                        <td className="muted">{l.scraper_mode || '—'}</td>
                        <td>{l.structure_changed ? <span className="badge retried">changed</span> : <span className="muted">ok</span>}</td>
                        <td className="muted" style={{ whiteSpace: 'normal', maxWidth: 320 }}>{l.error || ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <div className="empty">No scrape attempts yet.</div>
          )}

          {tab === 'settings' && t && (
            <div>
              <div className="row" style={{ marginBottom: 14 }}>
                <label className="muted small">Scrape every</label>
                <select className="input" style={{ width: 170 }} value={intervalMin} onChange={(e) => setIntervalMin(Number(e.target.value))}>
                  <option value={30}>30 minutes</option>
                  <option value={60}>1 hour</option>
                  <option value={120}>2 hours</option>
                  <option value={360}>6 hours</option>
                  <option value={720}>12 hours</option>
                  <option value={1440}>24 hours</option>
                </select>
                <button className="btn sm" onClick={saveSettings}>Save</button>
              </div>
              <div className="row">
                <button className="btn primary" onClick={runNow} disabled={running}>
                  {running ? <span className="spinner" /> : '▶'} {running ? 'Scraping…' : 'Run scrape now'}
                </button>
                <button className="btn danger" onClick={remove}>Delete tracked product</button>
              </div>
              <div className="code-note" style={{ marginTop: 16 }}>
                Tracking since {utc(t.created_at)} · last scraped {ago(t.last_scraped_at)}<br />
                Structure fingerprint: <span className="mono">{t.structure_fp || '—'}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
