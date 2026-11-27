import { useId } from 'react';

/**
 * Accessible single-series SVG bar chart.
 * - role="img" with <title>/<desc> and aria-labelledby
 * - visible value labels on every bar (few bars, so labels never collide)
 * - per-bar <title> tooltip on hover
 * - visually-hidden data table fallback
 * Single series → one colour, so no legend is needed (the figcaption names it).
 */
export default function BarChart({ title, data, format = String, color = 'var(--chart-1)', orientation = 'horizontal', unitLabel = 'Value' }) {
  const id = useId();
  const max = Math.max(1, ...data.map((d) => d.value));
  const summary = data.length
    ? `${data.length} bars. Highest: ${[...data].sort((a, b) => b.value - a.value)[0].label}, ${format([...data].sort((a, b) => b.value - a.value)[0].value)}.`
    : 'No data.';

  let svg;
  if (orientation === 'vertical') {
    const W = 560; const H = 240; const top = 24; const bottom = 36; const left = 8; const right = 8;
    const slot = (W - left - right) / Math.max(1, data.length);
    const bw = Math.min(56, slot * 0.6);
    const ph = H - top - bottom;
    svg = (
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby={`${id}-t ${id}-d`}>
        <title id={`${id}-t`}>{title}</title>
        <desc id={`${id}-d`}>{summary}</desc>
        <line x1={left} x2={W - right} y1={top + ph} y2={top + ph} stroke="var(--color-border-strong)" strokeWidth="1" />
        {data.map((d, i) => {
          const h = Math.max(d.value > 0 ? 2 : 0, (d.value / max) * ph);
          const x = left + slot * i + (slot - bw) / 2;
          const y = top + ph - h;
          return (
            <g key={d.label}>
              <title>{`${d.label}: ${format(d.value)}`}</title>
              <rect x={left + slot * i} y={top} width={slot} height={ph} fill="transparent" />
              <path d={roundedTop(x, y, bw, h, Math.min(4, h))} fill={color} />
              <text x={x + bw / 2} y={y - 6} textAnchor="middle" fontSize="12" fontWeight="600">{format(d.value)}</text>
              <text x={x + bw / 2} y={H - 14} textAnchor="middle" fontSize="12" className="axis-label">{d.short || d.label}</text>
            </g>
          );
        })}
      </svg>
    );
  } else {
    const rowH = 34; const labelW = 130; const valueW = 96; const W = 560;
    const H = Math.max(rowH, data.length * rowH) + 8;
    const plotW = W - labelW - valueW;
    svg = (
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby={`${id}-t ${id}-d`}>
        <title id={`${id}-t`}>{title}</title>
        <desc id={`${id}-d`}>{summary}</desc>
        <line x1={labelW} x2={labelW} y1={0} y2={H - 4} stroke="var(--color-border-strong)" strokeWidth="1" />
        {data.map((d, i) => {
          const w = Math.max(d.value > 0 ? 2 : 0, (d.value / max) * plotW);
          const y = 4 + i * rowH;
          const bh = 20;
          return (
            <g key={d.label}>
              <title>{`${d.label}: ${format(d.value)}`}</title>
              <rect x={0} y={y} width={W} height={rowH - 2} fill="transparent" />
              <text x={labelW - 8} y={y + bh / 2 + 5} textAnchor="end" fontSize="13">{truncate(d.label, 17)}</text>
              <path d={roundedRight(labelW, y + 2, w, bh, Math.min(4, w))} fill={color} />
              <text x={labelW + w + 6} y={y + bh / 2 + 5} fontSize="13" fontWeight="600">{format(d.value)}</text>
            </g>
          );
        })}
      </svg>
    );
  }

  return (
    <figure className="card chart-card">
      <figcaption>{title}</figcaption>
      {data.length === 0 ? <p className="muted">No data for this period yet.</p> : <div className="chart">{svg}</div>}
      {data.length > 0 && (
        <table className="visually-hidden">
          <caption>{title}</caption>
          <thead><tr><th scope="col">Item</th><th scope="col">{unitLabel}</th></tr></thead>
          <tbody>{data.map((d) => <tr key={d.label}><th scope="row">{d.label}</th><td>{format(d.value)}</td></tr>)}</tbody>
        </table>
      )}
    </figure>
  );
}

function truncate(s, n) { return s.length > n ? `${s.slice(0, n - 1)}…` : s; }

function roundedRight(x, y, w, h, r) {
  if (w <= 0) return '';
  return `M${x},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h - r} Q${x + w},${y + h} ${x + w - r},${y + h} H${x} Z`;
}
function roundedTop(x, y, w, h, r) {
  if (h <= 0) return '';
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
}
