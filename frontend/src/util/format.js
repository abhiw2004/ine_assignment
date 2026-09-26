export const inr = (n) =>
  n == null || n === '' || Number.isNaN(Number(n))
    ? '—'
    : '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });

export const num = (n) => (n == null || n === '' ? '—' : Number(n).toLocaleString('en-IN'));

export function ago(iso) {
  if (!iso) return 'never';
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function utc(iso) {
  if (!iso) return '—';
  return new Date(iso).toISOString().replace('T', ' ').replace('.000Z', ' UTC');
}

export function localTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

export const outcomeClass = (o) => (o === 'success' ? 'success' : o === 'retried' ? 'retried' : o === 'failed' ? 'failed' : 'muted');
