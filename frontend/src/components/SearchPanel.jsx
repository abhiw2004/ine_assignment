import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

/**
 * Search INE's mock store by partial/full name, pick a product, then pick the
 * option to track, and persist it. Debounced search against the backend (which
 * filters the cached catalog — the store API itself ignores query params).
 */
export default function SearchPanel({ onTracked, notify }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState(null); // full item with options
  const [optionId, setOptionId] = useState(null);
  const [intervalMin, setIntervalMin] = useState(120);
  const [loadingItem, setLoadingItem] = useState(false);
  const [tracking, setTracking] = useState(false);
  const timer = useRef(null);

  useEffect(() => {
    clearTimeout(timer.current);
    const query = q.trim();
    if (!query) { setResults([]); return; }
    timer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const data = await api.search(query, 25);
        setResults(data.results || []);
      } catch (e) {
        notify(`Search failed: ${e.message}`, 'err');
      } finally {
        setSearching(false);
      }
    }, 350);
    return () => clearTimeout(timer.current);
  }, [q]);

  async function pickProduct(p) {
    setLoadingItem(true);
    setSelected(null);
    setOptionId(null);
    try {
      const item = await api.item(p.id);
      setSelected(item);
      setOptionId(item.options?.[0]?.id || null);
    } catch (e) {
      notify(`Could not load product: ${e.message}`, 'err');
    } finally {
      setLoadingItem(false);
    }
  }

  async function track() {
    if (!selected || !optionId) return;
    setTracking(true);
    try {
      await api.track({ storeProductId: selected.id, optionId, scrapeIntervalMin: intervalMin, scrapeNow: true });
      const opt = selected.options.find((o) => o.id === optionId);
      notify(`Tracking "${selected.name}" — ${opt?.label}. First scrape queued…`, 'ok');
      setSelected(null); setQ(''); setResults([]); setOptionId(null);
      onTracked();
    } catch (e) {
      notify(`Track failed: ${e.message}`, 'err');
    } finally {
      setTracking(false);
    }
  }

  return (
    <div className="card">
      <h2>Track a product</h2>
      <p className="sub">Search INE&apos;s mock store by partial or full name, then choose the option to track.</p>

      <div className="search-row">
        <input
          className="input"
          placeholder="Search products… e.g. camera, guitar, hair dryer"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoFocus
        />
        {searching && <span className="btn ghost" style={{ pointerEvents: 'none' }}><span className="spinner" /></span>}
      </div>

      {results.length > 0 && !selected && (
        <div className="results">
          {results.map((r) => (
            <div key={r.id} className="result-item" onClick={() => pickProduct(r)}>
              <div>
                <div className="name">{r.name}</div>
                <div className="meta">{r.brand} · {r.category} · SKU {r.sku} · id {r.id}</div>
              </div>
              <span className="badge info">select</span>
            </div>
          ))}
        </div>
      )}

      {results.length === 0 && q.trim() && !searching && (
        <div className="empty small">No products match “{q}”.</div>
      )}

      {loadingItem && <div className="empty small"><span className="spinner" /> Loading options…</div>}

      {selected && (
        <div style={{ marginTop: 14 }}>
          <div className="spread">
            <div>
              <div style={{ fontWeight: 700 }}>{selected.name}</div>
              <div className="muted small">{selected.brand} · {selected.category} · id {selected.id}</div>
            </div>
            <button className="btn ghost sm" onClick={() => setSelected(null)}>clear</button>
          </div>

          <div className="muted small" style={{ marginTop: 12, marginBottom: 6 }}>
            {selected.optionAxis || 'Option'} — pick the option to track (each has its own price):
          </div>
          <div className="option-picker">
            {(selected.options || []).map((o) => (
              <button
                key={o.id}
                className={`chip ${optionId === o.id ? 'on' : ''}`}
                onClick={() => setOptionId(o.id)}
              >
                {o.label}
              </button>
            ))}
          </div>

          <div className="row" style={{ marginTop: 8 }}>
            <label className="muted small">Scrape every</label>
            <select className="input" style={{ flex: '0 0 auto', width: 150 }} value={intervalMin}
              onChange={(e) => setIntervalMin(Number(e.target.value))}>
              <option value={30}>30 minutes</option>
              <option value={60}>1 hour</option>
              <option value={120}>2 hours (default)</option>
              <option value={360}>6 hours</option>
              <option value={720}>12 hours</option>
              <option value={1440}>24 hours</option>
            </select>
            <button className="btn primary" onClick={track} disabled={!optionId || tracking}>
              {tracking ? <span className="spinner" /> : '＋'} {tracking ? 'Tracking…' : 'Track product'}
            </button>
          </div>
          <p className="muted small" style={{ marginTop: 10 }}>
            The schedule is driven by an external cron (cron-job.org) hitting the backend every 2h;
            per-product intervals are respected on each pass.
          </p>
        </div>
      )}
    </div>
  );
}
