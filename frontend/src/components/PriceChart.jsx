import {
  ResponsiveContainer, ComposedChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ReferenceDot,
} from 'recharts';
import { inr, num, localTime } from '../util/format.js';

/**
 * Price + stock over time. Price on the left axis, stock on the right.
 * Failed scrapes produce no history point (we never store bad data), so gaps in
 * the line honestly reflect runs where nothing was captured.
 */
export default function PriceChart({ history = [], logs = [] }) {
  const data = history.map((h) => ({
    t: new Date(h.scraped_at).getTime(),
    price: Number(h.price),
    stock: Number(h.stock),
    label: localTime(h.scraped_at),
  }));

  const failed = logs
    .filter((l) => l.outcome === 'failed')
    .map((l) => ({ t: new Date(l.created_at).getTime(), label: localTime(l.created_at), error: l.error }));

  if (!data.length) {
    return <div className="empty">No successful scrapes yet — history will appear after the first run.</div>;
  }

  return (
    <div style={{ width: '100%', height: 320 }}>
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="#263252" strokeDasharray="3 3" />
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={['dataMin', 'dataMax']}
            tickFormatter={(v) => new Date(v).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
            stroke="#93a0bf" fontSize={11}
          />
          <YAxis yAxisId="price" stroke="#5b8cff" fontSize={11} tickFormatter={(v) => inr(v)} width={70} />
          <YAxis yAxisId="stock" orientation="right" stroke="#34d399" fontSize={11} allowDecimals={false} width={44} />
          <Tooltip
            contentStyle={{ background: '#151e36', border: '1px solid #263252', borderRadius: 10, fontSize: 12.5 }}
            labelFormatter={(v) => localTime(new Date(v).toISOString())}
            formatter={(value, name) => (name === 'price' ? [inr(value), 'Price'] : [num(value), 'Stock'])}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Line yAxisId="price" type="monotone" dataKey="price" name="price" stroke="#5b8cff" strokeWidth={2.5} dot={{ r: 2.5 }} activeDot={{ r: 5 }} />
          <Line yAxisId="stock" type="stepafter" dataKey="stock" name="stock" stroke="#34d399" strokeWidth={1.8} dot={false} />
          {failed.map((f, i) => (
            <ReferenceDot key={i} x={f.t} y={0} yAxisId="stock" r={0} />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
