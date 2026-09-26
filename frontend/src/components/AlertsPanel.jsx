import { ago } from '../util/format.js';

const KIND_COLOR = {
  price_drop: 'var(--green)',
  price_rise: 'var(--red)',
  back_in_stock: 'var(--accent)',
  out_of_stock: 'var(--amber)',
  structure_changed: 'var(--amber)',
};

/** Recent price-drop / back-in-stock / structure-change alerts (bonus). */
export default function AlertsPanel({ alerts = [] }) {
  return (
    <div className="card">
      <div className="section-title">
        <div>
          <h2>Alerts</h2>
          <p className="sub" style={{ margin: 0 }}>Price drops, stock changes & structure drift</p>
        </div>
        <span className="badge muted">{alerts.length}</span>
      </div>

      {alerts.length === 0 ? (
        <div className="empty small">No alerts yet. They appear when a scrape detects a price drop, a stock change, or a page-structure change.</div>
      ) : (
        <div style={{ maxHeight: 300, overflow: 'auto' }}>
          {alerts.map((a) => {
            const tp = a.tracked_products || {};
            return (
              <div key={a.id} className="alert-item">
                <span className="alert-dot" style={{ background: KIND_COLOR[a.kind] || 'var(--muted)' }} />
                <div style={{ minWidth: 0 }}>
                  <div>{a.message}</div>
                  <div className="muted small" style={{ marginTop: 2 }}>
                    <span className="badge muted" style={{ marginRight: 6 }}>{a.kind.replace(/_/g, ' ')}</span>
                    {tp.name ? `${tp.name} · ` : ''}{ago(a.created_at)}
                    {a.emailed ? ' · emailed' : ''}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
