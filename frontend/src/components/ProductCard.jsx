import { inr, num, ago, outcomeClass } from '../util/format.js';

/** Compact dashboard card for one tracked product+option. */
export default function ProductCard({ t, onOpen, onRun, onDelete, running }) {
  const stockIn = t.last_in_stock;
  return (
    <div className="card product-card" onClick={() => onOpen(t)}>
      <div className="top">
        <div style={{ minWidth: 0 }}>
          <div className="pname" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.name}</div>
          <div className="popt">
            {t.option_axis ? `${t.option_axis}: ` : ''}{t.option_label} · id {t.store_product_id}
          </div>
        </div>
        {t.last_outcome && (
          <span className={`badge ${outcomeClass(t.last_outcome)}`}>{t.last_outcome}</span>
        )}
      </div>

      <div className="price-big">{t.last_price != null ? inr(t.last_price) : <span className="muted" style={{ fontSize: 16 }}>no data yet</span>}</div>

      <div className="row" style={{ gap: 8 }}>
        {t.last_stock != null ? (
          <span className={`pill-stock ${stockIn ? 'in' : 'out'}`}>
            {stockIn ? `In stock · ${num(t.last_stock)}` : 'Out of stock'}
          </span>
        ) : (
          <span className="badge muted">stock —</span>
        )}
        <span className="muted small">scraped {ago(t.last_scraped_at)}</span>
      </div>

      <div className="kv">
        <span>Brand <b>{t.brand || '—'}</b></span>
        <span>Every <b>{t.scrape_interval_min}m</b></span>
      </div>

      <div className="card-actions" onClick={(e) => e.stopPropagation()}>
        <button className="btn sm" onClick={() => onOpen(t)}>Details</button>
        <button className="btn sm" onClick={() => onRun(t)} disabled={running}>
          {running ? <span className="spinner" /> : '▶'} Run now
        </button>
        <button className="btn sm danger" onClick={() => onDelete(t)}>Delete</button>
      </div>
    </div>
  );
}
