// Backend origin. In dev, Vite proxies /api -> localhost:8080 so this is ''.
// In production (Vercel), set VITE_API_URL to the Render backend origin.
export const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

async function req(path, opts = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts,
  });
  const text = await res.text();
  let data = null;
  if (text) { try { data = JSON.parse(text); } catch { data = { raw: text }; } }
  if (!res.ok) {
    const msg = (data && data.error) || `HTTP ${res.status}`;
    const e = new Error(msg);
    e.status = res.status;
    throw e;
  }
  return data;
}

export const api = {
  health: () => req('/health'),
  scrapeConfig: () => req('/api/scrape/config'),

  search: (q, limit = 25) => req(`/api/catalog/search?q=${encodeURIComponent(q)}&limit=${limit}`),
  item: (id) => req(`/api/catalog/item/${id}`),

  listTracked: () => req('/api/tracked'),
  track: (payload) => req('/api/tracked', { method: 'POST', body: JSON.stringify(payload) }),
  trackedDetail: (id) => req(`/api/tracked/${id}`),
  updateTracked: (id, patch) => req(`/api/tracked/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteTracked: (id) => req(`/api/tracked/${id}`, { method: 'DELETE' }),
  scrapeNow: (id) => req(`/api/tracked/${id}/scrape`, { method: 'POST' }),

  alerts: (limit = 50) => req(`/api/alerts?limit=${limit}`),

  exportCsvUrl: () => `${API_BASE}/api/export.csv`,
};
